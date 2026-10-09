/**
 * Popup 面板：就绪检查 → 获取阵容画面（抓帧/粘贴/文件，可多张）→ 分析 → 渲染结果。
 * - 分析任务跑在 background 并持久化到 storage.session：popup 关闭重开后自动恢复状态；
 * - 截图列表同样持久化（storage.session.capturedImages），与视频页内浮动面板互通。
 */

import type { AnalysisOutput, Box, LockedOps, TaskState } from "../shared/types";
import { esc, renderResult, renderLockedSection, type HasOp } from "../shared/render";
import {
  loadPicks,
  resolvePickFromRow,
  togglePick,
  type DispatchPicks,
} from "../shared/dispatchPicks";
import { schemeKeyOf } from "../shared/dispatchPool";
import {
  getStageKindOverrides,
  isAmbiguousStageResolution,
  resolveStageKind,
  shouldShowDispatchAction,
  type StageKindOverrides,
} from "../shared/stageKind";
import { shrinkImage } from "../shared/img";
import {
  clearCachedResult,
  getCachedResult,
  normalizePage,
  putCachedResult,
  type ResultCacheEntry,
} from "../shared/resultCache";
import { clearStageSkip, dropStagePools, excludeStages, patchStagePools, queryStagePools } from "../shared/stageRecode";
import { wireHoverDetails } from "../shared/hoverDetails";
import { wireGridPicker } from "../shared/gridPicker";
import { wireShowHidden } from "../shared/toggles";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface PageContext {
  bvid: string | null;
  page: number | null;
  videoPage: boolean;
}

const IMG_KEY = "capturedImages";

let capturedImages: string[] = []; // dataURL 列表（编队页 + 助战详情页等）
let currentCtx: PageContext = { bvid: null, page: null, videoPage: false };
let pollTimer: number | undefined;
let hasOp: HasOp = () => false;
let llmReady = false;
let lockedOps: LockedOps = {};
/** §9.3 候选池勾选态（关卡显示码 → 已勾选方案） */
let dispatchPicks: DispatchPicks = {};
let stageKindOverrides: StageKindOverrides = {};
/** 本页被用户手动排除的前置关（识别不准时用；按 bvid|page 存） */
let excludedStages: string[] = [];
/** 候选池过滤（设置页可调）：默认只列可抄方案、每关最多 12 条 */
let hideUnavailable = true;
let schemeRows = 12;
let colorBySource = true;
let currentResult: AnalysisOutput | null = null;

function taskMatchesCurrent(task: TaskState): boolean {
  return (
    !!currentCtx.bvid &&
    task.bvid === currentCtx.bvid &&
    normalizePage(task.page) === normalizePage(currentCtx.page)
  );
}

function formatCacheTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function getPageContext(): Promise<PageContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const bvid = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = url.match(/[?&]p=(\d+)/);
  let page = p ? parseInt(p[1]!, 10) : null;

  if (bvid) return { bvid, page, videoPage: true };

  // 回退：host/activeTab 权限拿不到 URL 时，问页面内的 content script（它一定能看到 location）
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
      if (resp?.bvid) return { bvid: resp.bvid, page: resp.page ?? null, videoPage: true };
    } catch {
      /* content script 未注入（扩展加载前已打开的页面） */
    }
  }
  return { bvid: null, page: null, videoPage: false };
}

async function renderChecklist(): Promise<void> {
  currentCtx = await getPageContext();
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const { llm, apiKey } = (await chrome.storage.local.get(["llm", "apiKey"])) as {
    llm?: { baseUrl?: string; model?: string; mode?: string };
    apiKey?: string;
  };
  const llmReadyNow = llm?.mode === "web" || !!(llm?.baseUrl && llm?.model) || !!apiKey;
  llmReady = llmReadyNow;
  hasOp = (n) => !!box?.operators[n];
  const { advanced } = (await chrome.storage.local.get("advanced")) as {
    advanced?: { hideUnavailableSchemes?: boolean; schemeRows?: number; colorBySource?: boolean };
  };
  hideUnavailable = advanced?.hideUnavailableSchemes !== false; // 默认：只列可抄方案
  schemeRows = Number.isFinite(Number(advanced?.schemeRows)) ? Number(advanced?.schemeRows) : 12;
  colorBySource = advanced?.colorBySource !== false; // 默认：MAA 蓝 / B站 粉

  const items = [
    currentCtx.videoPage
      ? `<span class="ok">✓</span> 当前在攻略视频页${currentCtx.page ? `（第 ${currentCtx.page} 分P）` : ""}`
      : `<span class="bad">✗</span> 未识别到 BV 号（请在B站视频页使用；若已在视频页，刷新页面后重开插件）`,
    boxCount > 0
      ? `<span class="ok">✓</span> 干员 box 已导入（${boxCount} 名）`
      : `<span class="bad">✗</span> 未导入干员 box`,
    llmReadyNow
      ? `<span class="ok">✓</span> AI 接口已配置`
      : `<span class="bad">✗</span> 未配置 AI 接口（点下方「设置」）`,
  ];
  $("checklist").innerHTML = items.join("<br>");
  updateAnalyzeButton();
}

function updateAnalyzeButton(): void {
  ($("analyzeBtn") as HTMLButtonElement).disabled =
    capturedImages.length === 0 || !currentCtx.videoPage || !llmReady;
}

async function persistImages(): Promise<void> {
  await chrome.storage.session.set({ [IMG_KEY]: capturedImages });
}

function renderPreview(): void {
  const img = $("preview") as HTMLImageElement;
  const count = $("imgCount");
  const clear = $("clearBtn");
  if (capturedImages.length === 0) {
    img.style.display = "none";
    count.style.display = "none";
    clear.style.display = "none";
  } else {
    img.src = capturedImages[capturedImages.length - 1]!;
    img.style.display = "block";
    count.textContent =
      capturedImages.length === 1 ? "已添加 1 张（可继续追加助战详情页截图）" : `已添加 ${capturedImages.length} 张`;
    count.style.display = "block";
    clear.style.display = "block";
  }
  updateAnalyzeButton();
}

function addImage(dataUrl: string): void {
  if (capturedImages.length >= 4) {
    $("status").innerHTML = `<span class="err">最多 4 张截图</span>`;
    return;
  }
  capturedImages.push(dataUrl);
  void persistImages();
  renderPreview();
  $("status").textContent = "";
}

function clearImages(): void {
  capturedImages = [];
  void persistImages();
  renderPreview();
}

/** 抓取当前视频画面（content script canvas） */
async function grabFrame(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  $("status").textContent = "抓取中…";
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "GRAB_FRAME" });
    if (resp?.ok && resp.dataUrl) {
      addImage(resp.dataUrl);
    } else {
      $("status").innerHTML = `<span class="err">${esc(resp?.reason ?? "抓取失败，请用截图 + Ctrl+V 粘贴")}</span>`;
    }
  } catch {
    $("status").innerHTML = `<span class="err">无法连接页面（请刷新视频页后重试），或直接截图后 Ctrl+V 粘贴</span>`;
  }
}

function wireImageInputs(): void {
  $("grabBtn").addEventListener("click", grabFrame);

  // Ctrl+V 粘贴截图
  document.addEventListener("paste", (e) => {
    const items = (e as ClipboardEvent).clipboardData?.items;
    const imgItem = items ? [...items].find((i) => i.type.startsWith("image/")) : undefined;
    if (!imgItem) return;
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(blob);
  });

  // 文件选择
  $("pickFile").addEventListener("click", (e) => {
    e.preventDefault();
    ($("fileInput") as HTMLInputElement).click();
  });
  $("fileInput").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(file);
  });

  $("clearBtn").addEventListener("click", clearImages);
}

function setWebUi(status: string | undefined): void {
  ($("pasteBox") as HTMLElement).style.display = status === "web_paste" ? "block" : "none";
}

// ---------- 占用清单（派遣锁定，矢量突破类活动） ----------

function stageSkipKey(): string {
  return `${currentCtx.bvid ?? ""}|${normalizePage(currentCtx.page)}`;
}

async function loadExcluded(): Promise<void> {
  const { dispatchStageSkips } = (await chrome.storage.local.get("dispatchStageSkips")) as {
    dispatchStageSkips?: Record<string, string[]>;
  };
  excludedStages = dispatchStageSkips?.[stageSkipKey()] ?? [];
}

async function loadLocks(): Promise<void> {
  const { lockedOps: lo } = (await chrome.storage.local.get("lockedOps")) as { lockedOps?: LockedOps };
  lockedOps = lo ?? {};
  dispatchPicks = await loadPicks();
  renderLocks();
}

function renderLocks(): void {
  const el = $("locks");
  if (!el) return;
  el.innerHTML = renderLockedSection(lockedOps);
  const n = Object.keys(lockedOps).length;
  $("lockCount").textContent = n ? `（${n} 人）` : "";
}

/** 共享关卡分流：只有派遣关才挂「加入占用清单」按钮。 */
function showResult(result: AnalysisOutput): void {
  currentResult = result;
  const stageKind = resolveStageKind(result.stage, result.videoTitle, stageKindOverrides);
  const ambiguousDispatch = isAmbiguousStageResolution(result.stageResolution);
  $("result").innerHTML = renderResult(result, hasOp, lockedOps, {
    stageKind: stageKind.kind,
    ambiguousDispatch,
    picks: dispatchPicks,
    hideUnavailable,
    maxSchemeRows: schemeRows,
    colorBySource,
    guideEvidence: result.dispatchGuideEvidence,
    excludedStages,
    stageOptions: result.dispatchStageOptions,
  });

  // 「⤢ 大窗口查看结果」：任何关卡类型都提供（独立扩展窗口，勾选双向同步）
  const bigBtn = document.createElement("button");
  bigBtn.className = "act ghost";
  bigBtn.style.cssText =
    "margin:4px 0;padding:7px 12px;font-size:13px;border-radius:6px;background:#f0f3f5;color:#333;border:1px solid #d0d7de;cursor:pointer";
  bigBtn.textContent = "⤢ 大窗口查看结果";
  bigBtn.title = "在新窗口铺开显示：本关阵容 + 各前置关候选池 + 占用清单（勾选双向同步）";
  bigBtn.addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_BIG_RESULT", result: currentResult, height: 980 });
  });
  $("result").prepend(bigBtn); // 放结果最上方（用户反馈：原先在最下方看不见）

  if (!shouldShowDispatchAction(stageKind.kind, ambiguousDispatch)) return;

  const btn = document.createElement("button");
  btn.className = "act ghost";
  btn.style.cssText = "margin:4px 0;padding:7px 12px;font-size:13px;border-radius:6px;background:#f0f3f5;color:#333;border:1px solid #d0d7de;cursor:pointer";
  btn.textContent = "➕ 本关阵容加入占用清单";
  btn.addEventListener("click", async () => {
    const names = result.roster.slots.filter((s) => !s.support).map((s) => s.operator);
    const { lockedOps: lo } = (await chrome.storage.local.get("lockedOps")) as { lockedOps?: LockedOps };
    const merged: LockedOps = { ...(lo ?? {}) };
    for (const n of names) merged[n] = result.stage;
    await chrome.storage.local.set({ lockedOps: merged });
    lockedOps = merged;
    renderLocks();
    btn.textContent = `已加入占用清单 ✓（${names.length} 人）`;
    (btn as HTMLButtonElement).disabled = true;
  });
  $("result").appendChild(btn);
}

/** 点候选方案整行 = 勾选该方案（点在链接/折叠摘要/复选框上时交给原生行为） */
function wireRowClick(container: HTMLElement): void {
  container.addEventListener("click", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || target.closest("a") || target.closest("summary")) return;
    const row = target.closest<HTMLElement>('[data-pick-row="1"]');
    if (!row) return;
    const box = row.querySelector<HTMLInputElement>('input[data-pick="1"]');
    if (!box || target === box) return;
    box.click(); // 触发 change → 既有的 onPickChange
  });
}

/**
 * §9.3 候选池勾选：勾选即占用（同关自动换选），立即重渲染下方结果，不重新分析；
 * 取消勾选 → 移出占用清单 → 颜色立即恢复。
 */
async function onPickChange(input: HTMLInputElement): Promise<void> {
  if (!currentResult) return;
  try {
    const pick = resolvePickFromRow(input, currentResult);
    if (!pick) {
      $("status").innerHTML = `<span class="err">勾选未生效：这一行不在当前结果里（可能是旧结果缓存），请重新分析后再试</span>`;
      showResult(currentResult);
      return;
    }
    // ① 先改内存状态并重渲染——不等存储写入：即使存储失败，界面也照常更新
    const outcome = togglePick(lockedOps, dispatchPicks, pick);
    lockedOps = outcome.lockedOps;
    dispatchPicks = outcome.picks;
    renderLocks();
    showResult(currentResult);
    // ② 再持久化；失败要显式告知（此前 await 抛错会跳过渲染，表现成「勾了没反应」）
    try {
      await chrome.storage.local.set({ lockedOps, dispatchPicks });
      $("status").textContent = outcome.checked
        ? `已占用 ${pick.ops.length} 名干员（${pick.stageCode}）——下方结果已实时置灰`
        : `已取消 ${pick.stageCode} 的占用`;
    } catch (err) {
      $("status").innerHTML = `<span class="err">勾选已生效，但写入本地存储失败：${esc((err as Error)?.message ?? String(err))}（刷新后可能丢失；可到设置页清空分析缓存）</span>`;
    }
  } catch (err) {
    $("status").innerHTML = `<span class="err">勾选处理失败：${esc((err as Error)?.message ?? String(err))}</span>`;
  }
}

/**
 * 手动补关：结果区「＋ 补一个关…」/「选择补给关…」（第十一轮 q3）——后台现查这些关的 MAA/B站 方案
 * 并并入当前结果（后台会带上关卡链前置关），写入结果缓存（刷新后仍保留，无需重新分析）。
 */
async function applyStageCodes(
  codes: readonly string[],
  remove: readonly string[] = [],
): Promise<void> {
  if (!currentResult) return;
  const list = codes.map((c) => String(c ?? "").trim().toUpperCase()).filter(Boolean);
  const dropList = remove.map((c) => String(c ?? "").trim().toUpperCase()).filter(Boolean);
  if (!list.length && !dropList.length) return;
  const page = currentCtx.page;
  const key = stageSkipKey();
  let next = currentResult;
  if (list.length) {
    $("status").textContent = `正在查询 ${list.join("、")} 的候选方案（MAA + B站，约 3-10 秒）…`;
    const pools = await queryStagePools(list);
    if (!pools.length && !dropList.length) {
      $("status").innerHTML = `<span class="err">查询 ${list.join("、")} 失败（无网络或该关暂无数据），可稍后重试</span>`;
      return;
    }
    if (pools.length) {
      next = patchStagePools(next, pools);
      for (const code of list) await clearStageSkip(key, code);
    }
  }
  if (dropList.length) {
    // 网格选关里取消勾选 = 这一关识别错了：写「不是这关」排除记录 + 从结果里拿掉（第十五轮 q2）
    await excludeStages(key, dropList);
    next = dropStagePools(next, dropList);
  }
  currentResult = next;
  await putCachedResult(next, page);
  $("status").textContent =
    [list.length ? `查回 ${list.join("、")}` : "", dropList.length ? `移除 ${dropList.join("、")}` : ""]
      .filter(Boolean)
      .join("；") + " 完成";
  showResult(next);
}

async function onStageRecode(sel: HTMLSelectElement): Promise<void> {
  const code = sel.value.trim().toUpperCase();
  if (!code) return;
  sel.value = "";
  await applyStageCodes([code]);
}

function showCachedResult(entry: ResultCacheEntry): void {
  showResult(entry.result);
  $("status").innerHTML =
    `<span class="hint">上次分析：${formatCacheTime(entry.ts)} ｜ </span>` +
    `<a href="#" id="reanalyze" class="settings">重新分析</a>` +
    `<a href="#" id="clearPageCache" class="settings" style="margin-left:6px" ` +
    `title="只清这个视频/分P的缓存结果（其它视频不受影响；设置页可清全部）">清除本页缓存</a>`;
  $("reanalyze").addEventListener("click", (e) => {
    e.preventDefault();
    $("status").textContent = "";
    triggerAnalyze();
  });
  $("clearPageCache").addEventListener("click", (e) => {
    e.preventDefault();
    void (async () => {
      const bvid = currentCtx.bvid;
      if (!bvid) return;
      const removed = await clearCachedResult(bvid, currentCtx.page);
      currentResult = null;
      showEmptyState();
      $("status").innerHTML = removed
        ? `<span class="hint">已清掉「${esc(bvid)}${currentCtx.page ? ` P${currentCtx.page}` : ""}」的缓存，可以重新分析。</span>`
        : `<span class="hint">本页本来就没有缓存。</span>`;
    })();
  });
}

function showEmptyState(): void {
  $("result").innerHTML = "";
  $("status").innerHTML =
    `<span class="hint">当前分P尚无分析结果。请暂停在编队画面，抓帧或粘贴截图后点击「分析此关卡」。</span>`;
}

/** 轮询后台任务状态（popup 关闭重开也能恢复） */
let pollStartedAt = 0;
let sawMatchingTask = false;

function pollTask(waitForNewTask = false): void {
  if (pollTimer) window.clearInterval(pollTimer);
  pollStartedAt = Date.now();
  sawMatchingTask = !waitForNewTask;
  pollTimer = window.setInterval(async () => {
    const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
      | { task: TaskState | null }
      | null;
    const task = resp?.task;
    if (!task || !taskMatchesCurrent(task)) {
      // 当前页刚发起任务时给后台一点写入 task 的时间，避免误命中旧缓存。
      if (!sawMatchingTask && Date.now() - pollStartedAt < 5000) return;
      if (!currentCtx.bvid) return;
      const cached = await getCachedResult(currentCtx.bvid, currentCtx.page);
      if (cached) {
        window.clearInterval(pollTimer!);
        pollTimer = undefined;
        setWebUi(undefined);
        showCachedResult(cached);
      }
      return;
    }
    sawMatchingTask = true;
    setWebUi(task.status);
    if (task.status === "running" && task.progress) {
      $("status").textContent = `${task.progress}（约 20-60 秒）`;
    } else if (task.status === "web_paste") {
      $("status").textContent = task.progress ?? "等待你粘贴 DeepSeek 回复…";
    } else if (task.status === "done" && task.result) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      setWebUi(undefined);
      $("status").textContent = "";
      showResult(task.result);
    } else if (task.status === "error") {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      setWebUi(undefined);
      $("status").innerHTML = `<span class="err">${esc(task.error ?? "分析失败")}</span>`;
    } else if (task.status === "running" && Date.now() - task.startedAt > 300_000) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      $("status").innerHTML = `<span class="err">分析超时（5 分钟），请重试</span>`;
    }
  }, 1500);
}

async function submitPaste(): Promise<void> {
  const input = $("pasteInput") as HTMLTextAreaElement;
  const text = input.value.trim();
  if (!text) return;
  const resp = (await chrome.runtime.sendMessage({ type: "PASTE_REPLY", text })) as
    | { ok: boolean }
    | undefined;
  if (resp?.ok) {
    input.value = "";
    setWebUi(undefined);
    $("status").textContent = "已提交，生成结果中…";
  } else {
    $("status").innerHTML = `<span class="err">当前没有等待中的回复请求（可能已结束），请重新分析</span>`;
  }
}

function triggerAnalyze(): void {
  if (!currentCtx.bvid || capturedImages.length === 0) return;
  void (async () => {
    $("result").innerHTML = "";
    const dataUrls = await Promise.all(capturedImages.map(shrinkImage));
    // fire-and-forget：结果经 storage.session 轮询获取（popup 关闭不丢）
    void chrome.runtime.sendMessage({
      type: "ANALYZE_VIDEO",
      bvid: currentCtx.bvid,
      page: currentCtx.page ?? undefined,
      imageDataUrls: dataUrls,
    });
    $("status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒，可切走稍后回来看）";
    pollTask(true);
  })();
}

/** popup 重开时恢复：截图列表 + 后台任务状态 */
async function restoreState(): Promise<void> {
  const stored = (await chrome.storage.session.get(IMG_KEY)) as Record<string, string[]>;
  capturedImages = stored[IMG_KEY] ?? [];
  renderPreview();

  const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
    | { task: TaskState | null }
    | null;
  const task = resp?.task;
  const matches = !!task && taskMatchesCurrent(task);
  setWebUi(matches ? task.status : undefined);
  if (matches && (task.status === "running" || task.status === "web_paste") && Date.now() - task.startedAt < 1_800_000) {
    $("status").textContent =
      task.status === "running"
        ? "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒）"
        : task.progress ?? "等待你的操作…";
    pollTask();
  } else if (matches && task.status === "done" && task.result) {
    showResult(task.result);
  } else if (matches && task.status === "error" && task.error) {
    $("status").innerHTML = `<span class="err">${esc(task.error)}</span>`;
  } else if (currentCtx.bvid) {
    const cached = await getCachedResult(currentCtx.bvid, currentCtx.page);
    if (cached) showCachedResult(cached);
    else showEmptyState();
  } else {
    showEmptyState();
  }
}

async function init(): Promise<void> {
  await renderChecklist();
  await loadLocks();
  await loadExcluded();
  stageKindOverrides = await getStageKindOverrides();
  wireImageInputs();
  $("analyzeBtn").addEventListener("click", triggerAnalyze);
  $("pasteSubmit").addEventListener("click", () => void submitPaste());
  // 占用清单：chips 移除 + 清除全部 + 跨入口同步
  $("locks").addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement).closest(".rmlock");
    if (!rm) return;
    const name = rm.getAttribute("data-name") ?? "";
    void (async () => {
      const { lockedOps: lo } = (await chrome.storage.local.get("lockedOps")) as { lockedOps?: LockedOps };
      const merged: LockedOps = { ...(lo ?? {}) };
      delete merged[name];
      await chrome.storage.local.set({ lockedOps: merged });
    })();
  });
  $("lockClear").addEventListener("click", (e) => {
    e.preventDefault();
    // 清单与候选池勾选一起清空（否则勾选态与占用不一致）
    void chrome.storage.local.set({ lockedOps: {}, dispatchPicks: {} });
  });
  // §9.3 候选池勾选（事件委托：#result 每次重渲染后依然有效）
  $("result").addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input[data-pick="1"]')) void onPickChange(target as HTMLInputElement);
  });
  wireRowClick($("result")); // 点整行 = 勾选该方案
  wireHoverDetails($("result")); // 候选池折叠块：悬浮即展开（第十轮 q3）
  wireGridPicker($("result"), (sel) => void applyStageCodes(sel.add, sel.remove)); // 选择补给关（第十一轮 q3／第十五轮 q2 可取消）
  wireShowHidden($("result")); // 「点开查看」缺干员被隐藏的方案（第十三轮 q1）
  // 「＋ 补一个关…」：手动补漏识别的派遣关（change 委托）
  $("result").addEventListener("change", (e: Event) => {
    const sel = (e.target as HTMLElement | null)?.closest?.("select[data-act]") as HTMLSelectElement | null;
    if (sel) void onStageRecode(sel);
  });
  // 「不是这关 / 恢复」：识别不准时手动纠正前置关列表
  $("result").addEventListener("click", (e) => {
    const link = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("[data-act]");
    const act = link?.getAttribute("data-act");
    if (act !== "skip-stage" && act !== "restore-stage") return;
    e.preventDefault();
    const code = (link?.getAttribute("data-code") ?? "").toUpperCase();
    if (!code) return;
    void (async () => {
      const key = currentCtx.bvid ? stageSkipKey() : "";
      if (!key) return;
      const { dispatchStageSkips } = (await chrome.storage.local.get("dispatchStageSkips")) as {
        dispatchStageSkips?: Record<string, string[]>;
      };
      const all = { ...(dispatchStageSkips ?? {}) };
      const cur = new Set(all[key] ?? []);
      if (act === "skip-stage") cur.add(code);
      else cur.delete(code);
      all[key] = [...cur];
      await chrome.storage.local.set({ dispatchStageSkips: all });
    })();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.dispatchStageSkips) {
      void (async () => {
        await loadExcluded();
        if (currentResult) showResult(currentResult);
      })();
    }
    if (area === "local" && (changes.lockedOps || changes.dispatchPicks)) {
      if (changes.lockedOps) lockedOps = (changes.lockedOps.newValue as LockedOps | undefined) ?? {};
      if (changes.dispatchPicks) {
        dispatchPicks = (changes.dispatchPicks.newValue as DispatchPicks | undefined) ?? {};
      }
      renderLocks();
      if (currentResult) showResult(currentResult); // 勾选/取消 → 结果区实时置灰/恢复
    }
    if (area === "local" && changes.stageKindOverrides) {
      stageKindOverrides = (changes.stageKindOverrides.newValue as StageKindOverrides | undefined) ?? {};
      if (currentResult) showResult(currentResult);
    }
  });
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  await restoreState();
}

init();
