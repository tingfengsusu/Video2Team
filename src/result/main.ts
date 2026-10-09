/**
 * 结果大窗口页（chrome.windows.create 的 popup 窗口，~940px）
 *
 * 设计 B ·「Data-Dense Dashboard」：依据 ui-ux-pro-max 技能的设计系统查询结论实现——
 * 蓝数据 + 琥珀强调 / Fira Sans + Fira Code（数字 tabular）/ 内联 SVG 图标（不用 emoji）/
 * KPI 卡条 + 行高亮 + 可见 focus ring + 200ms 过渡；并提供筛选（全部·未选·已选 + 方案搜索）。
 *
 * 数据来源：
 * - 结果本体：`storage.session.bigResult`（面板点「⤢ 大窗口」时写入）
 * - 占用清单 / 勾选态 / 练度表 / 关卡类型覆盖：`storage.local`（与面板共用，双向实时同步）
 */
import type { AnalysisOutput, Box, LockedOps } from "../shared/types";
import {
  esc,
  renderLockedSection,
  renderResultSections,
  type HasOp,
} from "../shared/render";
import { loadPicks, togglePick, type DispatchPicks } from "../shared/dispatchPicks";
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
/** 关卡筛选：all / unpicked / picked */
let stageFilter: "all" | "unpicked" | "picked" = "all";
/** 方案搜索词（匹配干员 / 标题 / 来源） */
let query = "";

function renderLocks(): void {
  const el = document.getElementById("locks");
  if (!el) return;
  el.innerHTML = renderLockedSection(lockedOps, true); // 设计 B：plain 标记
  const count = document.getElementById("lockCount");
  if (count) count.textContent = `${Object.keys(lockedOps).length} 人`;
}

/** KPI 条：数据可见性优先（技能风格的关键要素） */
function renderKpis(): void {
  const el = $("kpis");
  if (!current) {
    el.innerHTML = "";
    return;
  }
  const roster = current.roster.slots.length;
  const subs = current.recommendations.filter((s) => s.status === "substituted").length;
  const unresolved = current.recommendations.filter((s) => s.status === "unresolved").length;
  const guides = current.dispatchGuides ?? [];
  const pickedN = guides.filter((p) => picks[p.displayCode.toUpperCase()]).length;
  const locks = Object.keys(lockedOps).length;
  const cell = (label: string, value: string, unit = "", tone = "") =>
    `<div class="kpi ${tone}"><div class="k-label">${esc(label)}</div>` +
    `<div class="k-value">${esc(value)}${unit ? `<span class="k-unit"> ${esc(unit)}</span>` : ""}</div></div>`;
  el.innerHTML = [
    cell("本关阵容", String(roster), "人"),
    cell("已替换", String(subs), "处", subs ? "warn" : ""),
    cell("无解", String(unresolved), "处", unresolved ? "bad" : ""),
    cell("前置关已选", `${pickedN}/${guides.length}`),
    cell("占用干员", String(locks), "人", locks ? "warn" : ""),
  ].join("");
}

function render(): void {
  renderKpis();
  if (!current) {
    $("stageName").textContent = "";
    $("poolCount").textContent = "";
    $("slotCount").textContent = "";
    const ctxEmpty = document.getElementById("context");
    if (ctxEmpty) ctxEmpty.innerHTML = "";
    $("col-pool").innerHTML =
      `<div class="hint">还没有结果：回到B站视频页 → 打开面板 → 分析 → 点「⤢ 大窗口查看结果」。</div>`;
    $("col-main").innerHTML = "";
    renderLocks();
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
    showGuidesHeading: false, // 由面板标题承担
    showSlotsHeading: false, // 同上
    plainIcons: true, // 设计 B：不用 emoji 标记（技能规范），图标走内联 SVG
  });
  const pools = current.dispatchGuides ?? [];
  const totalSchemes = pools.reduce((n, p) => n + p.schemes.length, 0);
  $("poolCount").textContent = `${pools.length} 关 · ${totalSchemes} 套`;
  $("slotCount").textContent = `${current.recommendations.length} 槽位`;
  $("col-pool").innerHTML =
    sections.guides || `<div class="hint">本次没有识别到前置关（未检测到特别战线网格）。</div>`;
  const ctx = document.getElementById("context");
  if (ctx) ctx.innerHTML = sections.intro; // 视频标题 / 关卡类型提示 / 「其实是派遣关」切换链接
  $("col-main").innerHTML = sections.overview + sections.slots;
  applyFilters();
  renderLocks();
}

/** 筛选：关卡（全部/未选/已选）+ 方案搜索词；纯前端，不改数据 */
function applyFilters(): void {
  const q = query.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".stagepool").forEach((pool) => {
    const picked = pool.dataset.picked === "1";
    const stageOk =
      stageFilter === "all" || (stageFilter === "picked" ? picked : !picked);
    let rowsMatched = 0;
    pool.querySelectorAll<HTMLElement>(".schemerow").forEach((row) => {
      const hay = `${row.dataset.search ?? ""} ${row.dataset.ops ?? ""}`.toLowerCase();
      const ok = !q || hay.includes(q);
      row.hidden = !ok;
      if (ok) rowsMatched += 1;
    });
    pool.hidden = !stageOk || (!!q && rowsMatched === 0);
  });
  const empty = [...document.querySelectorAll<HTMLElement>(".stagepool")].every((p) => p.hidden);
  const box = $("col-pool");
  let note = document.getElementById("poolFilterNote");
  if (empty) {
    if (!note) {
      note = document.createElement("div");
      note.id = "poolFilterNote";
      note.className = "hint";
      note.style.padding = "8px 0";
      box.prepend(note);
    }
    note.textContent =
      stageFilter === "picked" ? "还没有已选好方案的前置关。" : "当前筛选下没有匹配的方案。";
  } else if (note) {
    note.remove();
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
    box.click(); // 触发 change → onPickChange
  });
}

/** 候选池勾选：与面板/popup 共用同一套 lockedOps / dispatchPicks，双向同步 */
async function onPickChange(input: HTMLInputElement): Promise<void> {
  if (!current) return;
  const stageCode = input.getAttribute("data-stage") ?? "";
  const key = input.getAttribute("data-scheme") ?? "";
  const pool = (current.dispatchGuides ?? []).find(
    (p) => p.displayCode.toUpperCase() === stageCode.toUpperCase(),
  );
  const scheme = pool?.schemes.find((s) => schemeKeyOf(s) === key);
  if (!pool || !scheme) return;
  const outcome = togglePick(lockedOps, picks, {
    stageCode: pool.displayCode,
    stageName: pool.stageName,
    key,
    ops: scheme.operators,
  });
  lockedOps = outcome.lockedOps;
  picks = outcome.picks;
  await chrome.storage.local.set({ lockedOps, dispatchPicks: picks });
  render();
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
  hideUnavailable = advanced?.hideUnavailableSchemes !== false;
  maxRows = Number.isFinite(Number(advanced?.schemeRows)) ? Number(advanced?.schemeRows) : 12;
  colorBySource = advanced?.colorBySource !== false;
  picks = await loadPicks();
  overrides = await getStageKindOverrides();
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
      ? `结果时间 ${new Date(payload.ts).toLocaleString()} ｜ 勾选与本页/面板双向实时同步`
      : "";
  } catch {
    current = null;
    $("status").innerHTML = `<span class="err">读取结果失败（storage.session 不可用）</span>`;
  }
}

async function init(): Promise<void> {
  await loadLocal();
  await loadResult();
  render();

  $("refreshBtn").addEventListener("click", () => {
    void (async () => {
      await loadLocal();
      await loadResult();
      render();
    })();
  });
  $("clearLocks").addEventListener("click", () => {
    void chrome.storage.local.set({ lockedOps: {}, dispatchPicks: {} });
  });
  // 筛选：关卡状态分段控件
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((btn) => {
    btn.addEventListener("click", () => {
      stageFilter = (btn.dataset.filter as typeof stageFilter) ?? "all";
      document
        .querySelectorAll<HTMLButtonElement>(".seg button")
        .forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
      applyFilters();
    });
  });
  // 筛选：方案搜索
  $<HTMLInputElement>("searchInput").addEventListener("input", (e) => {
    query = (e.target as HTMLInputElement).value;
    applyFilters();
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[BIG_RESULT_KEY]) {
      void (async () => {
        await loadResult();
        render();
      })();
      return;
    }
    if (area !== "local") return;
    if (changes.lockedOps ?? changes.dispatchPicks ?? changes.box ?? changes.advanced ?? changes.stageKindOverrides) {
      void (async () => {
        await loadLocal();
        render();
      })();
    }
  });
}

void init();
