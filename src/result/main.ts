/**
 * 结果大窗口页（chrome.windows.create 的 popup 窗口，~940px）：
 * 与视频页面板 / popup 共用同一份 `renderResultSections`，按**两栏卡片**铺开
 * （左：本关适配阵容；右：总览 + 前置关候选池 + 占用清单），抄作业时不用在小面板里滚。
 *
 * 数据来源：
 * - 结果本体：`storage.session.bigResult`（面板点「⤢ 大窗口」时写入）
 * - 占用清单 / 勾选态 / 练度表 / 关卡类型覆盖：`storage.local`（与面板共用，**双向实时同步**）
 */
import type { AnalysisOutput, Box, LockedOps } from "../shared/types";
import {
  esc,
  renderLockedSection,
  renderResultSections,
  type HasOp,
} from "../shared/render";
import { loadPicks, resolvePickFromRow, togglePick, type DispatchPicks } from "../shared/dispatchPicks";
import { putCachedResult } from "../shared/resultCache";
import { clearStageSkip, patchStagePools, queryStagePools } from "../shared/stageRecode";
import { wireHoverDetails } from "../shared/hoverDetails";
import { wireGridPicker } from "../shared/gridPicker";
import { wireShowHidden } from "../shared/toggles";
import { schemeKeyOf } from "../shared/dispatchPool";
import {
  getStageKindOverrides,
  isAmbiguousStageResolution,
  resolveStageKind,
  type StageKindOverrides,
} from "../shared/stageKind";

export const BIG_RESULT_KEY = "bigResult";

interface BigResultPayload {
  result: AnalysisOutput;
  ts: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/**
 * 安全绑定：元素不存在时只告警、不抛错。
 * 教训（2026-10-09）：页面里某个面板被删/在无结果时不渲染，而 init() 仍去 addEventListener →
 * 抛错 → 其后所有监听（勾选、点行、Esc、storage 同步）都没挂上，表现为"怎么点都没反应"。
 */
function on(id: string, event: string, handler: (e: Event) => void): void {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[result] 页面缺少 #${id}，已跳过该绑定`);
    return;
  }
  el.addEventListener(event, handler);
}

let current: AnalysisOutput | null = null;
let lockedOps: LockedOps = {};
let picks: DispatchPicks = {};
let overrides: StageKindOverrides = {};
let hasOp: HasOp = () => false;
let hideUnavailable = true;
let maxRows = 12;
let colorBySource = true;
/** 本页被用户手动排除的前置关（识别不准时用） */
let excludedStages: string[] = [];

function renderLocks(): void {
  const el = document.getElementById("locks");
  if (!el) return; // 还没有结果（右栏未渲染）
  el.innerHTML = renderLockedSection(lockedOps);
  const n = Object.keys(lockedOps).length;
  const count = document.getElementById("lockCount");
  if (count) count.textContent = n ? `（${n} 人）` : "";
}

/** 顶部摘要 chips：人数 / 替换 / 无解 / 占用人 */
function renderChips(): void {
  const chips: string[] = [];
  if (current) {
    const rosterCount = current.roster.slots.length;
    const subs = current.recommendations.filter((s) => s.status === "substituted").length;
    const unresolved = current.recommendations.filter((s) => s.status === "unresolved").length;
    const guides = current.dispatchGuides ?? [];
    if (rosterCount) chips.push(`阵容 ${rosterCount} 人`);
    if (subs) chips.push(`替换 ${subs} 处`);
    if (unresolved) chips.push(`无解 ${unresolved} 处`);
    if (guides.length) {
      const pickedN = guides.filter((p) => picks[p.displayCode.toUpperCase()]).length;
      chips.push(`前置关 ${pickedN}/${guides.length} 已选`);
    }
    chips.push(`占用 ${Object.keys(lockedOps).length} 人`);
  }
  $("chips").innerHTML = chips
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join(" ");
}

function render(): void {
  renderChips();
  if (!current) {
    $("stageName").textContent = "";
    $("col-main").innerHTML = `<div class="card"><div class="card-title">还没有结果</div><div class="hint">回到B站视频页 → 打开面板 → 分析 → 点「⤢ 大窗口查看结果」。</div></div>`;
    $("col-side").innerHTML = "";
    return;
  }
  const kind = resolveStageKind(current.stage, current.videoTitle, overrides);
  const ambiguous = isAmbiguousStageResolution(current.stageResolution);
  $("stageName").textContent = current.stage;
  const sections = renderResultSections(current, hasOp, lockedOps, {
    stageKind: kind.kind,
    ambiguousDispatch: ambiguous,
    picks,
    hideUnavailable,
    maxSchemeRows: maxRows,
    colorBySource,
    showGuidesHeading: false, // 大窗口里由卡片标题承担，避免重复
    guideEvidence: current.dispatchGuideEvidence,
    excludedStages,
    stageOptions: current.dispatchStageOptions,
  });
  // 左栏：前置关候选池（主交互）；右栏：本关用这套 + 阵容。
  // 第十二轮 p2/p3：移除「占用清单」卡片（占用状态在每个干员名上就有，顶部还有「占用 N 人」chip，
  // 「清除占用」按钮独立走 storage，不依赖这张卡）；没有派遣关时（普通关）改单栏居中，不留空卡片。
  const hasPoolSection = !!sections.guides;
  document.querySelector(".cols")?.classList.toggle("single", !hasPoolSection);
  const resultCard = `<div class="card">${sections.intro}${sections.overview}${sections.slots}</div>`;
  if (hasPoolSection) {
    $("col-main").innerHTML =
      `<div class="card">` +
      `<div class="card-title">🚩 前置关候选池 <span class="sub">勾选＝该关采用这套（点整行也能勾选）</span></div>` +
      `${sections.guides}` +
      `</div>`;
    $("col-side").innerHTML = resultCard;
  } else {
    $("col-main").innerHTML = resultCard;
    $("col-side").innerHTML = "";
  }
  renderLocks();
}

/**
 * 手动补关：结果区「＋ 补一个关…」/ 网格选关（第十一轮 q3）——后台现查这些关的 MAA/B站 方案
 * 并并入当前结果（后台会带上关卡链前置关），写入结果缓存（大窗口刷新/重开不丢）。
 */
async function applyStageCodes(codes: readonly string[]): Promise<void> {
  if (!current) return;
  const list = codes.map((c) => String(c ?? "").trim().toUpperCase()).filter(Boolean);
  if (!list.length) return;
  const st = document.getElementById("status");
  const label = list.join("、");
  if (st) st.textContent = `正在查询 ${label} 的候选方案（MAA + B站，约 3-10 秒）…`;
  const pools = await queryStagePools(list);
  if (!pools.length) {
    if (st) st.innerHTML = `<span class="err">查询 ${label} 失败（无网络或该关暂无数据），可稍后重试</span>`;
    return;
  }
  const next = patchStagePools(current, pools);
  current = next;
  const page = next.roster.page ?? 0;
  await putCachedResult(next, page);
  for (const code of list) await clearStageSkip(`${next.bvid}|${page}`, code);
  if (st) st.textContent = `已更新 ${pools.map((p) => p.displayCode).join("、")} 的候选方案（共 ${pools.length} 关）`;
  render();
}

async function onStageRecode(sel: HTMLSelectElement): Promise<void> {
  const code = sel.value.trim().toUpperCase();
  if (!code) return;
  sel.value = "";
  await applyStageCodes([code]);
}

async function loadLocal(): Promise<void> {
  const { box, lockedOps: lo, advanced } = (await chrome.storage.local.get([
    "box",
    "lockedOps",
    "advanced",
  ])) as {
    box?: Box;
    lockedOps?: LockedOps;
    advanced?: { hideUnavailableSchemes?: boolean; schemeRows?: number; colorBySource?: boolean };
  };
  hasOp = (n) => !!box?.operators[n];
  lockedOps = lo ?? {};
  hideUnavailable = advanced?.hideUnavailableSchemes !== false; // 默认开
  maxRows = Number.isFinite(Number(advanced?.schemeRows)) ? Number(advanced?.schemeRows) : 12;
  colorBySource = advanced?.colorBySource !== false; // 默认：MAA 蓝 / B站 粉
  picks = await loadPicks();
  overrides = await getStageKindOverrides();
  const { dispatchStageSkips } = (await chrome.storage.local.get("dispatchStageSkips")) as {
    dispatchStageSkips?: Record<string, string[]>;
  };
  const skipKey = current ? `${current.bvid}|${current.roster.page ?? 0}` : "";
  excludedStages = skipKey ? dispatchStageSkips?.[skipKey] ?? [] : [];
}

async function loadResult(): Promise<void> {
  try {
    const stored = (await chrome.storage.session.get(BIG_RESULT_KEY)) as Record<
      string,
      BigResultPayload | undefined
    >;
    const payload = stored[BIG_RESULT_KEY];
    current = payload?.result ?? null;
    $("status").textContent = payload
      ? `结果时间：${new Date(payload.ts).toLocaleString()}（勾选/取消勾选会实时同步到这个窗口与视频页面板）`
      : "";
  } catch {
    current = null;
    $("status").innerHTML = `<span class="err">读取结果失败（storage.session 不可用）</span>`;
  }
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

/** 候选池勾选：与大窗口共用同一套 lockedOps / dispatchPicks，双向同步 */
async function onPickChange(input: HTMLInputElement): Promise<void> {
  if (!current) return;
  const st = document.getElementById("status");
  try {
    const pick = resolvePickFromRow(input, current);
    if (!pick) {
      if (st) st.innerHTML = `<span class="err">勾选未生效：这一行不在当前结果里（可能是旧结果缓存），请回面板重新分析</span>`;
      render();
      return;
    }
    // ① 先改内存状态并重渲染——不等存储写入：即使存储失败，界面也照常更新
    const outcome = togglePick(lockedOps, picks, pick);
    lockedOps = outcome.lockedOps;
    picks = outcome.picks;
    renderLocks();
    render();
    // ② 再持久化；失败要显式告知（此前 await 抛错会跳过渲染，表现成「勾了没反应」）
    try {
      await chrome.storage.local.set({ lockedOps, dispatchPicks: picks });
      if (st) {
        st.textContent = outcome.checked
          ? `已占用 ${pick.ops.length} 名干员（${pick.stageCode}）——本页与面板同步更新`
          : `已取消 ${pick.stageCode} 的占用`;
      }
    } catch (err) {
      if (st) st.innerHTML = `<span class="err">勾选已生效，但写入本地存储失败：${esc((err as Error)?.message ?? String(err))}（刷新后可能丢失）</span>`;
    }
  } catch (err) {
    if (st) st.innerHTML = `<span class="err">勾选处理失败：${esc((err as Error)?.message ?? String(err))}</span>`;
  }
}

async function init(): Promise<void> {
  await loadLocal();
  await loadResult();
  renderLocks();
  render();

  on("refreshBtn", "click", () => {
    void (async () => {
      await loadLocal();
      await loadResult();
      renderLocks();
      render();
    })();
  });
  // Esc / 「✕ 关闭」：popup 窗口不响应 Esc，需要自己监听
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.close();
  });
  on("closeBtn", "click", () => window.close());
  on("clearLocks", "click", () => {
    void chrome.storage.local.set({ lockedOps: {}, dispatchPicks: {} });
  });
  // 占用 chip 的「移除」：body 委托（#locks 只在有结果时渲染，委托写法与它在不在无关）
  document.body.addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement | null)?.closest(".rmlock");
    if (!rm) return;
    const name = rm.getAttribute("data-name") ?? "";
    void (async () => {
      const { lockedOps: lo } = (await chrome.storage.local.get("lockedOps")) as { lockedOps?: LockedOps };
      const merged: LockedOps = { ...(lo ?? {}) };
      delete merged[name];
      await chrome.storage.local.set({ lockedOps: merged });
    })();
  });
  document.body.addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input[data-pick="1"]')) void onPickChange(target as HTMLInputElement);
  });
  wireRowClick(document.body);
  wireHoverDetails(document.body); // 候选池折叠块：悬浮即展开（第十轮 q3）
  wireGridPicker(document.body, (codes) => void applyStageCodes(codes)); // 网格选关（第十一轮 q3）
  wireShowHidden(document.body); // 「点开查看」缺干员被隐藏的方案（第十三轮 q1）
  // 「＋ 补一个关…」：手动补漏识别的派遣关（body 委托，容器每次重渲染）
  document.body.addEventListener("change", (e) => {
    const sel = (e.target as HTMLElement | null)?.closest?.("select[data-act]") as HTMLSelectElement | null;
    if (sel) void onStageRecode(sel);
  });
  document.body.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement | null)?.closest<HTMLAnchorElement>("[data-act]");
    const act = link?.getAttribute("data-act");
    if (act !== "skip-stage" && act !== "restore-stage") return;
    e.preventDefault();
    const code = (link?.getAttribute("data-code") ?? "").toUpperCase();
    if (!code || !current) return;
    void (async () => {
      const key = `${current!.bvid}|${current!.roster.page ?? 0}`;
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
    if (area === "session" && changes[BIG_RESULT_KEY]) {
      void (async () => {
        await loadResult();
        render();
      })();
      return;
    }
    if (area !== "local") return;
    if (changes.lockedOps ?? changes.dispatchPicks ?? changes.box ?? changes.advanced ?? changes.stageKindOverrides ?? changes.dispatchStageSkips) {
      void (async () => {
        await loadLocal();
        render();
      })();
    }
  });
}

void init();
