/**
 * Content Script：
 * 1. 识别B站视频页（BV/分P），供 popup 查询（host 权限不可见 URL 时的回退）；
 * 2. 抓取播放器当前帧（MSE blob 同源，canvas 可绘制）；
 * 3. 视频页浮动入口（右侧 hover 唤起）+ 页内面板：抓帧/粘贴/文件 → 分析 → 结果展示。
 *    页内面板不随点击页面而关闭（popup 的固有问题），且截图与 popup 经
 *    storage.session.capturedImages 互通。
 */

import type { AnalysisOutput, Box, LockedOps, TaskState } from "../shared/types";
import { esc, renderResult, renderLockedSection, type HasOp } from "../shared/render";
import {
  loadPicks,
  togglePick,
  type DispatchPicks,
} from "../shared/dispatchPicks";
import { schemeKeyOf } from "../shared/dispatchPool";
import {
  getStageKindOverrides,
  isAmbiguousStageResolution,
  resolveStageKind,
  setStageKindOverride,
  shouldShowDispatchAction,
  type StageKindOverrides,
} from "../shared/stageKind";
import { shrinkImage } from "../shared/img";
import {
  getCachedResult,
  normalizePage,
  type ResultCacheEntry,
} from "../shared/resultCache";

// ---------- 基础能力 ----------

function parseContext(): { bvid: string | null; page: number | null } {
  const bvid = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = new URLSearchParams(location.search).get("p");
  return { bvid, page: p ? parseInt(p, 10) : null };
}

function grabFrameRaw(): { ok: boolean; dataUrl?: string; reason?: string } {
  const video = document.querySelector("video");
  if (!video || !video.videoWidth) {
    return { ok: false, reason: "页面未找到视频画面（请确认视频已开始播放）" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "画布创建失败" };
  ctx.drawImage(video, 0, 0);
  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
  } catch {
    return { ok: false, reason: "画面受保护无法直接抓取，请暂停后用截图 + Ctrl+V 粘贴" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PAGE_CONTEXT") {
    sendResponse(parseContext());
  }
  if (msg?.type === "GRAB_FRAME") {
    sendResponse(grabFrameRaw());
  }
  // B站 API 代理：在页面上下文发请求（Origin=bilibili.com、Cookie/buvid 与正常浏览一致），
  // 绕开 CDN 对扩展后台环境（Origin: chrome-extension://）的风控
  if (msg?.type === "BILI_FETCH" && typeof msg.url === "string") {
    fetch(msg.url, { credentials: "include" })
      .then(async (r) => sendResponse({ ok: true, status: r.status, text: await r.text() }))
      .catch((err: Error) => sendResponse({ ok: false, status: 0, text: err.message }));
    return true;
  }
});

// ---------- 浮动入口 + 页内面板 ----------

const IMG_KEY = "capturedImages";
const host = document.createElement("div");
host.id = "video2team-host";
let shadow: ShadowRoot | null = null;
let panelOpen = false;
let images: string[] = [];
/** 默认按「没有」处理（更保守，不会误报拥有）；openPanel 时从 localStorage box 加载真实判断 */
let hasOp: HasOp = () => false;
let pollTimer: number | undefined;
let stageKindOverrides: StageKindOverrides = {};
let currentResult: AnalysisOutput | null = null;

function taskMatchesCurrent(task: TaskState): boolean {
  const { bvid, page } = parseContext();
  return !!bvid && task.bvid === bvid && normalizePage(task.page) === normalizePage(page);
}

function formatCacheTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, "Microsoft YaHei", sans-serif; }

  /* 右缘 hover 感应区：鼠标移入滑出按钮 */
  .hoverzone {
    position: fixed; right: 0; top: 38%; width: 22px; height: 180px; z-index: 2147483646;
  }
  .fab {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%) translateX(120%);
    writing-mode: vertical-rl; letter-spacing: 4px;
    padding: 10px 8px; font-size: 13px; cursor: pointer; white-space: nowrap;
    background: #23ade5; color: #fff; border: none; border-radius: 10px 0 0 10px;
    box-shadow: -2px 2px 8px rgba(0,0,0,.25);
    transition: transform .18s ease; opacity: 0; pointer-events: none;
  }
  .hoverzone:hover .fab { transform: translateY(-50%) translateX(0); opacity: 1; pointer-events: auto; }

  /* 页内面板 */
  .panel {
    position: fixed; right: 14px; top: 70px; width: min(92vw, 460px); max-height: 82vh; overflow-y: auto;
    background: #fff; border-radius: 12px; padding: 14px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); z-index: 2147483647; display: none;
  }
  .panel.open { display: block; }
  /* 吸顶头部：结果很长滚到底部时，关闭按钮始终可见 */
  .phead { position: sticky; top: -14px; z-index: 2; background: #fff;
           margin: -14px -14px 4px; padding: 12px 14px 8px; display: flex;
           align-items: center; justify-content: space-between;
           border-radius: 12px 12px 0 0; box-shadow: 0 2px 6px rgba(0,0,0,.06); }
  .phead h1 { font-size: 15px; margin: 0; }
  .tagline { font-size: 11px; color: #888; margin-bottom: 8px; }
  .close { border: none; background: #f0f3f5; border-radius: 6px; padding: 2px 10px;
           font-size: 14px; cursor: pointer; color: #666; }
  .close:hover { background: #e2e8ed; }
  .settings { border: none; background: #f0f3f5; border: 1px solid #d0d7de; border-radius: 6px;
              font-size: 12px; padding: 4px 10px; cursor: pointer; color: #333; margin-bottom: 6px; }
  .readiness .ok { color: #1a7f37; }
  .readiness .bad { color: #c0392b; }
  button.act { margin: 4px 0; padding: 7px 12px; font-size: 13px; cursor: pointer;
           border: none; border-radius: 6px; background: #23ade5; color: #fff; }
  button.act:disabled { background: #aaa; cursor: not-allowed; }
  button.ghost { background: #f0f3f5; color: #333; border: 1px solid #d0d7de; }
  .hint { font-size: 11px; color: #888; line-height: 1.6; }
  .zone { border: 1.5px dashed #c8d0d6; border-radius: 8px; padding: 8px; text-align: center; margin: 6px 0; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .thumb { position: relative; width: 82px; }
  .thumb img { width: 82px; height: 46px; object-fit: cover; border-radius: 4px; display: block; }
  .thumb .rm { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; line-height: 15px;
               text-align: center; background: #c0392b; color: #fff; border-radius: 50%;
               font-size: 11px; cursor: pointer; }
  #status { font-size: 12px; color: #666; margin: 6px 0; }
  .pasteinput { width: 100%; height: 84px; font-size: 12px; box-sizing: border-box;
                margin-top: 4px; font-family: inherit; }
  .video-title { font-size: 12px; color: #555; margin: 6px 0; }
  .stage { font-size: 15px; font-weight: bold; margin: 10px 0 4px; }
  /* q4 可读性：槽位放大到 14px、放宽行高与间距，别让用户逐字抠 */
  .slot { font-size: 14px; line-height: 1.65; padding: 6px 9px; border-radius: 5px; margin-bottom: 5px;
          background: #fafbfc; border-left: 3px solid #d0d7de; }
  .keep { border-left-color: #1a7f37; }
  .sub { border-left-color: #d29922; }
  .unresolved { border-left-color: #c0392b; }
  .slot .note { color: #c0392b; font-size: 12px; }
  .slot a, a.link { color: #23ade5; text-decoration: none; font-size: 12px; }
  .slot .alts { font-size: 12px; color: #555; margin-top: 2px; }
  .sub-line { display: block; line-height: 1.7; }
  .own { color: #1a7f37; font-weight: 700; }
  .miss { color: #c0392b; font-weight: 700; }
  /* §9.3 被占用：灰色 + 删除线（+ 🔒 徽章） */
  .occupied { color: #999; text-decoration: line-through; }
  .pickbox { cursor: pointer; margin: 2px 0 0; }
  .quote { color: #999; }
  .dim { color: #888; font-size: 12px; }
  .err { font-size: 13px; color: #c0392b; }
`;

const PANEL_HTML = `
  <div class="hoverzone"><button class="fab">🎮 阵容适配</button></div>
  <div class="panel">
    <div class="phead">
      <h1>🎮 Video2Team</h1>
      <button class="close" title="收起">✕</button>
    </div>
    <div class="tagline">把大佬的作业，改成你抄得动的作业</div>
    <div class="readiness hint" style="margin-bottom:6px"></div>
    <button class="settings" data-act="settings" title="设置 API Key / 导入练度表">⚙ 设置</button>

    <div class="zone">
      <button class="act" data-act="grab">📷 抓取当前画面</button>
      <div class="hint">暂停在<strong>编队/阵容画面</strong>后抓帧；或 <strong>Ctrl+V 粘贴</strong> / <button class="link" data-act="pick" style="border:none;background:none;cursor:pointer;padding:0;font-size:11px;color:#23ade5">选择文件</button>（可多张，如助战详情页）</div>
      <input type="file" accept="image/*" style="display:none" />
      <div class="thumbs"></div>
      <div class="hint count" style="margin-top:4px"></div>
    </div>

    <button class="act" data-act="analyze" disabled>分析此关卡</button>
    <button class="act ghost" data-act="clear" style="display:none">清除全部截图</button>
    <div class="lockhead hint" style="margin-top:2px">🔒 占用清单（派遣关锁定）<span id="lockCount"></span><a href="#" data-act="lockclear" class="hint" style="color:#23ade5;margin-left:6px">清除全部</a></div>
    <div class="locks" style="margin:2px 0 4px"></div>
    <div id="status"></div>
    <div class="pastebox" style="display:none">
      <textarea class="pasteinput" placeholder="把 DeepSeek 的完整回复整段粘贴到这里（含 roster 与 substitutions 的 JSON）"></textarea>
      <button class="act" data-act="paste">提交回复，出结果</button>
    </div>
    <div id="result"></div>
    <div style="margin-top:10px;border-top:1px solid #eee;padding-top:8px">
      <button class="link" data-act="feedback" style="border:none;background:none;cursor:pointer;padding:0;font-size:11px;color:#23ade5">💬 反馈 / 建议（直达作者B站私信）</button>
    </div>
  </div>
`;

function q<T extends Element = Element>(sel: string): T {
  return shadow!.querySelector(sel)! as T;
}

async function persistImages(): Promise<void> {
  try {
    await chrome.storage.session.set({ [IMG_KEY]: images });
  } catch {
    /* session 不可用（权限/上下文）时静默：截图仅本次面板有效 */
  }
}

async function readImages(): Promise<string[]> {
  try {
    const stored = (await chrome.storage.session.get(IMG_KEY)) as Record<string, string[]>;
    return stored[IMG_KEY] ?? [];
  } catch {
    return images;
  }
}

async function loadBox(): Promise<void> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  hasOp = (n) => !!box?.operators[n];
}

/** 面板头部就绪状态：box / AI 接口（缺项红字提示去设置） */
async function renderReadiness(): Promise<void> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  const { llm, apiKey } = (await chrome.storage.local.get(["llm", "apiKey"])) as {
    llm?: { baseUrl?: string; model?: string; mode?: string };
    apiKey?: string;
  };
  const llmReady = llm?.mode === "web" || !!(llm?.baseUrl && llm?.model) || !!apiKey;
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const el = q(".readiness");
  el.innerHTML =
    (boxCount > 0
      ? `<span class="ok">✓ 练度表 ${boxCount} 人</span>`
      : `<span class="bad">✗ 未导入练度表</span>`) +
    " ｜ " +
    (llmReady ? `<span class="ok">✓ AI 接口</span>` : `<span class="bad">✗ 未配置 AI 接口</span>`) +
    " ｜ <span style='color:#888'>点「⚙ 设置」配置</span>";
}

function renderThumbs(): void {
  const wrap = q(".thumbs");
  wrap.innerHTML = images
    .map(
      (u, i) =>
        `<div class="thumb"><img src="${u}"><span class="rm" data-i="${i}" title="移除">✕</span></div>`,
    )
    .join("");
  const count = q<HTMLDivElement>(".count");
  const clearBtn = q<HTMLButtonElement>('[data-act="clear"]');
  count.textContent =
    images.length === 0 ? "" : images.length === 1 ? "已添加 1 张（可追加助战详情页）" : `已添加 ${images.length} 张`;
  clearBtn.style.display = images.length ? "" : "none";
  (q<HTMLButtonElement>('[data-act="analyze"]') as HTMLButtonElement).disabled = images.length === 0;
}

function addImage(dataUrl: string): void {
  if (images.length >= 4) {
    q("#status").innerHTML = `<span class="err">最多 4 张截图</span>`;
    return;
  }
  images.push(dataUrl);
  void persistImages();
  renderThumbs();
  q("#status").textContent = "";
}

async function grabFrame(): Promise<void> {
  q("#status").textContent = "抓取中…";
  const r = grabFrameRaw();
  if (r.ok && r.dataUrl) {
    addImage(r.dataUrl);
  } else {
    q("#status").innerHTML = `<span class="err">${esc(r.reason ?? "抓取失败，请截图后 Ctrl+V 粘贴")}</span>`;
  }
}

function setWebUi(status: string | undefined): void {
  q<HTMLElement>(".pastebox").style.display = status === "web_paste" ? "block" : "none";
}

// ---------- 占用清单（派遣锁定，矢量突破类活动） ----------

let lockedOps: LockedOps = {};
/** §9.3 候选池勾选态（关卡显示码 → 已勾选方案） */
let dispatchPicks: DispatchPicks = {};

async function loadLocks(): Promise<void> {
  const { lockedOps: lo } = (await chrome.storage.local.get("lockedOps")) as { lockedOps?: LockedOps };
  lockedOps = lo ?? {};
  dispatchPicks = await loadPicks();
  renderLocks();
}

function renderLocks(): void {
  if (!shadow) return;
  const el = shadow.querySelector(".locks");
  if (!el) return;
  el.innerHTML = renderLockedSection(lockedOps);
  const count = shadow.querySelector("#lockCount");
  if (count) {
    const n = Object.keys(lockedOps).length;
    count.textContent = n ? `（${n} 人）` : "";
  }
}

/** 共享关卡分流：只有派遣关才挂「加入占用清单」按钮。 */
function showResult(result: AnalysisOutput): void {
  currentResult = result;
  const stageKind = resolveStageKind(result.stage, result.videoTitle, stageKindOverrides);
  const ambiguousDispatch = isAmbiguousStageResolution(result.stageResolution);
  q("#result").innerHTML = renderResult(result, hasOp, lockedOps, {
    stageKind: stageKind.kind,
    allowDispatchSwitch: stageKind.kind === "unknown" && !ambiguousDispatch,
    ambiguousDispatch,
    picks: dispatchPicks,
  });

  const switchLink = shadow?.querySelector<HTMLAnchorElement>('[data-act="mark-dispatch"]');
  switchLink?.addEventListener("click", (e) => {
    e.preventDefault();
    void (async () => {
      stageKindOverrides = await setStageKindOverride(result.stage, result.videoTitle, "dispatch");
      showResult(result);
    })();
  });

  if (!shouldShowDispatchAction(stageKind.kind, ambiguousDispatch)) return;

  const btn = document.createElement("button");
  btn.className = "act ghost";
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
  q("#result").appendChild(btn);
}

/**
 * §9.3 候选池勾选：勾选即占用（同关自动换选），立即重渲染下方结果，不重新分析。
 * 取消勾选 → 移出占用清单 → 颜色立即恢复。
 */
async function onPickChange(input: HTMLInputElement): Promise<void> {
  if (!currentResult) return;
  const stageCode = input.getAttribute("data-stage") ?? "";
  const key = input.getAttribute("data-scheme") ?? "";
  const pool = (currentResult.dispatchGuides ?? []).find(
    (p) => p.displayCode.toUpperCase() === stageCode.toUpperCase(),
  );
  const scheme = pool?.schemes.find((s) => schemeKeyOf(s) === key);
  if (!pool || !scheme) return;
  const outcome = togglePick(lockedOps, dispatchPicks, {
    stageCode: pool.displayCode,
    stageName: pool.stageName,
    key,
    ops: scheme.operators,
  });
  lockedOps = outcome.lockedOps;
  dispatchPicks = outcome.picks;
  await chrome.storage.local.set({ lockedOps, dispatchPicks });
  renderLocks();
  q("#status").textContent = outcome.checked
    ? `已占用 ${scheme.operators.length} 名干员（${pool.displayCode}）——下方结果已实时置灰`
    : `已取消 ${pool.displayCode} 的占用`;
  showResult(currentResult);
}

function showCachedResult(entry: ResultCacheEntry): void {
  showResult(entry.result);
  q("#status").innerHTML =
    `<span class="hint">上次分析：${formatCacheTime(entry.ts)} ｜ </span>` +
    `<a href="#" data-act="reanalyze" class="link">重新分析</a>`;
  q('[data-act="reanalyze"]').addEventListener("click", (e) => {
    e.preventDefault();
    q("#status").textContent = "";
    void triggerAnalyze();
  });
}

function showEmptyState(): void {
  q("#result").innerHTML = "";
  q("#status").innerHTML =
    `<span class="hint">当前分P尚无分析结果。请暂停在编队画面，抓帧或粘贴截图后点击「分析此关卡」。</span>`;
}

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
      const { bvid, page } = parseContext();
      if (!bvid) return;
      const cached = await getCachedResult(bvid, page);
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
      q("#status").textContent = `${task.progress}（约 20-60 秒）`;
    } else if (task.status === "web_paste") {
      q("#status").textContent = task.progress ?? "等待你粘贴 DeepSeek 回复…";
    } else if (task.status === "done" && task.result) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      setWebUi(undefined);
      q("#status").textContent = "";
      showResult(task.result);
    } else if (task.status === "error") {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      setWebUi(undefined);
      q("#status").innerHTML = `<span class="err">${esc(task.error ?? "分析失败")}</span>`;
    } else if (task.status === "running" && Date.now() - task.startedAt > 300_000) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      q("#status").innerHTML = `<span class="err">分析超时（5 分钟），请重试</span>`;
    }
  }, 1500);
}

async function submitPaste(): Promise<void> {
  const input = q<HTMLTextAreaElement>(".pasteinput");
  const text = input.value.trim();
  if (!text) return;
  const resp = (await chrome.runtime.sendMessage({ type: "PASTE_REPLY", text })) as
    | { ok: boolean }
    | undefined;
  if (resp?.ok) {
    input.value = "";
    setWebUi(undefined);
    q("#status").textContent = "已提交，生成结果中…";
  } else {
    q("#status").innerHTML = `<span class="err">当前没有等待中的回复请求（可能已结束），请重新分析</span>`;
  }
}

async function triggerAnalyze(): Promise<void> {
  const { bvid, page } = parseContext();
  if (!bvid || images.length === 0) return;
  q("#result").innerHTML = "";
  const dataUrls = await Promise.all(images.map(shrinkImage));
  void chrome.runtime.sendMessage({
    type: "ANALYZE_VIDEO",
    bvid,
    page: page ?? undefined,
    imageDataUrls: dataUrls,
  });
  q("#status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒，面板可收起稍后回来看）";
  pollTask(true);
}

async function openPanel(): Promise<void> {
  panelOpen = true;
  q(".panel").classList.add("open");
  // 先加载 box（local storage，内容脚本恒可访问）——决定红绿着色的 hasOp
  await loadBox();
  await loadLocks();
  stageKindOverrides = await getStageKindOverrides();
  await renderReadiness();
  images = await readImages();
  renderThumbs();
  // 恢复后台任务状态
  const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
    | { task: TaskState | null }
    | null;
  const task = resp?.task;
  const matches = !!task && taskMatchesCurrent(task);
  setWebUi(matches ? task.status : undefined);
  if (matches && (task.status === "running" || task.status === "web_paste") && Date.now() - task.startedAt < 1_800_000) {
    q("#status").textContent =
      task.status === "running" ? "分析中…（约 20-60 秒）" : task.progress ?? "等待你的操作…";
    pollTask();
  } else if (matches && task.status === "done" && task.result) {
    showResult(task.result);
  } else if (matches && task.status === "error" && task.error) {
    q("#status").innerHTML = `<span class="err">${esc(task.error)}</span>`;
  } else {
    const { bvid, page } = parseContext();
    const cached = bvid ? await getCachedResult(bvid, page) : null;
    if (cached) showCachedResult(cached);
    else showEmptyState();
  }
}

function closePanel(): void {
  panelOpen = false;
  q(".panel").classList.remove("open");
}

function mount(): void {
  if (shadow) return;
  shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.innerHTML = PANEL_HTML;
  shadow.append(style, root);

  q(".fab").addEventListener("click", () => void openPanel());
  q(".close").addEventListener("click", closePanel);
  q('[data-act="grab"]').addEventListener("click", () => void grabFrame());
  q('[data-act="analyze"]').addEventListener("click", () => void triggerAnalyze());
  q('[data-act="clear"]').addEventListener("click", () => {
    images = [];
    void persistImages();
    renderThumbs();
  });
  q('[data-act="settings"]').addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
  });
  q('[data-act="feedback"]').addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_FEEDBACK" });
  });
  q('[data-act="paste"]').addEventListener("click", () => void submitPaste());
  q('[data-act="pick"]').addEventListener("click", () => q<HTMLInputElement>("input[type=file]").click());
  q<HTMLInputElement>("input[type=file]").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(file);
  });
  // 缩略图移除（事件委托）
  q(".thumbs").addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement).closest(".rm");
    if (!rm) return;
    const i = parseInt(rm.getAttribute("data-i") ?? "", 10);
    if (Number.isInteger(i)) {
      images.splice(i, 1);
      void persistImages();
      renderThumbs();
    }
  });
  // Ctrl+V 粘贴（仅面板打开时）
  document.addEventListener("paste", (e) => {
    if (!panelOpen) return;
    const items = (e as ClipboardEvent).clipboardData?.items;
    const imgItem = items ? [...items].find((i) => i.type.startsWith("image/")) : undefined;
    if (!imgItem) return;
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(blob);
  });
  // 占用清单：chips 移除（事件委托）+ 清除全部
  q(".locks").addEventListener("click", (e) => {
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
  q('[data-act="lockclear"]').addEventListener("click", (e) => {
    e.preventDefault();
    // 清单与候选池勾选一起清空（否则勾选态与占用不一致）
    void chrome.storage.local.set({ lockedOps: {}, dispatchPicks: {} });
  });
  // §9.3 候选池勾选（事件委托：#result 每次重渲染后依然有效）
  q("#result").addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input[data-pick="1"]')) void onPickChange(target as HTMLInputElement);
  });
  // popup 侧改动截图时同步（互通）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[IMG_KEY] && panelOpen) {
      images = (changes[IMG_KEY].newValue as string[] | undefined) ?? [];
      renderThumbs();
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

  document.documentElement.appendChild(host);
}

// SPA 导航：URL 变化时挂载/卸载（B站是单页应用）
function syncVisibility(): void {
  const on = !!location.pathname.match(/\/video\//);
  if (on) mount();
  if (shadow) host.style.display = on ? "" : "none";
}
setInterval(syncVisibility, 1000);
syncVisibility();
