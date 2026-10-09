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
    allowDispatchSwitch: kind.kind === "unknown" && !ambiguous,
    ambiguousDispatch: ambiguous,
    picks,
    hideUnavailable,
    maxSchemeRows: maxRows,
    colorBySource,
    showGuidesHeading: false, // 大窗口里由卡片标题承担，避免重复
    guideEvidence: current.dispatchGuideEvidence,
    excludedStages,
  });
  // 左栏：本关适配阵容（主内容）；右栏：总览 + 前置关候选池 + 占用清单
  $("col-main").innerHTML =
    `<div class="card">${sections.intro}${sections.slots}</div>`;
  $("col-side").innerHTML =
    `<div class="card">${sections.overview}</div>` +
    `<div class="card">` +
    `<div class="card-title">🚩 前置关候选池 <span class="sub">勾选＝该关采用这套（点整行也能勾选）</span></div>` +
    `${sections.guides || '<div class="hint">本次没有识别到前置关。</div>'}` +
    `</div>` +
    `<div class="card">` +
    `<div class="card-title">🔒 占用清单 <span class="sub" id="lockCount"></span></div>` +
    `<div id="locks"></div>` +
    `</div>`;
  renderLocks();
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
  const pick = resolvePickFromRow(input, current);
  if (!pick) {
    const st = document.getElementById("status");
    if (st) st.innerHTML = `<span class="err">勾选未生效：这一行不在当前结果里（可能是旧结果缓存），请回面板重新分析</span>`;
    render();
    return;
  }
  const outcome = togglePick(lockedOps, picks, pick);
  lockedOps = outcome.lockedOps;
  picks = outcome.picks;
  await chrome.storage.local.set({ lockedOps, dispatchPicks: picks });
  renderLocks();
  render();
}

async function init(): Promise<void> {
  await loadLocal();
  await loadResult();
  renderLocks();
  render();

  $("refreshBtn").addEventListener("click", () => {
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
  $("closeBtn").addEventListener("click", () => window.close());
  $("clearLocks").addEventListener("click", () => {
    void chrome.storage.local.set({ lockedOps: {}, dispatchPicks: {} });
  });
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
  document.body.addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input[data-pick="1"]')) void onPickChange(target as HTMLInputElement);
  });
  wireRowClick(document.body);
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
