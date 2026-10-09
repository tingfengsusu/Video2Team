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
 * 教训（2026-10-09）：按需求删掉「占用清单」面板后，init() 里残留的 `$("locks").addEventListener`
 * 抛错 → 后续所有监听（勾选、点行、Esc）都没挂上，表现为"大窗口里怎么点都没反应"。
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
/** 关卡筛选：all / unpicked / picked */
let stageFilter: "all" | "unpicked" | "picked" = "all";
/** 方案搜索词（匹配干员 / 标题 / 来源） */
let query = "";
/** 本页被用户手动排除的前置关（识别不准时用） */
let excludedStages: string[] = [];
function renderLocks(): void {
  const el = document.getElementById("locks");
  if (!el) return;
  el.innerHTML = renderLockedSection(lockedOps, true); // 设计 B：plain 标记
  const count = document.getElementById("lockCount");
  if (count) count.textContent = `${Object.keys(lockedOps).length} 人`;
}

function render(): void {
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
    ambiguousDispatch: ambiguous,
    picks,
    hideUnavailable,
    maxSchemeRows: maxRows,
    colorBySource,
    showGuidesHeading: false, // 由面板标题承担
    showSlotsHeading: false, // 同上
    plainIcons: true, // 设计 B：不用 emoji 标记（技能规范），图标走内联 SVG
    guideEvidence: current.dispatchGuideEvidence,
    excludedStages,
    stageOptions: current.dispatchStageOptions,
  });
  const pools = current.dispatchGuides ?? [];
  const totalSchemes = pools.reduce((n, p) => n + p.schemes.length, 0);
  $("poolCount").textContent = `${pools.length} 关 · ${totalSchemes} 套`;
  $("slotCount").textContent = `${current.recommendations.length} 槽位`;
  // 第十二轮 p3：没有派遣关时（普通关）隐藏候选池面板并改**单栏居中**，不留一张空卡片
  const hasPoolSection = !!sections.guides;
  document.querySelector(".grid")?.classList.toggle("single", !hasPoolSection);
  const poolPanel = document.getElementById("col-pool")?.closest<HTMLElement>(".panel");
  if (poolPanel) poolPanel.hidden = !hasPoolSection;
  $("col-pool").innerHTML = sections.guides;
  const ctx = document.getElementById("context");
  if (ctx) ctx.innerHTML = sections.intro; // 视频标题 / 关卡类型提示
  $("col-main").innerHTML = sections.slots; // 右栏只留阵容：总览/占用清单与候选池重复（用户反馈）
  applyFilters();
  renderLocks();
}

/** 筛选（设计 B）：关卡（全部/未选/已选）+ 方案搜索词；纯前端过滤，不改数据 */
function applyFilters(): void {
  const q = query.trim().toLowerCase();
  document.querySelectorAll<HTMLElement>(".stagepool").forEach((pool) => {
    const picked = pool.dataset.picked === "1";
    const stageOk = stageFilter === "all" || (stageFilter === "picked" ? picked : !picked);
    let rowsMatched = 0;
    pool.querySelectorAll<HTMLElement>(".schemerow").forEach((row) => {
      const hay = `${row.dataset.search ?? ""} ${row.dataset.ops ?? ""}`.toLowerCase();
      const ok = !q || hay.includes(q);
      row.hidden = !ok;
      if (ok) rowsMatched += 1;
    });
    pool.hidden = !stageOk || (!!q && rowsMatched === 0);
  });
  const box = document.getElementById("col-pool");
  if (!box) return;
  const empty = [...document.querySelectorAll<HTMLElement>(".stagepool")].every((p) => p.hidden);
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
    render();
    // ② 再持久化；失败要显式告知
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
  hideUnavailable = advanced?.hideUnavailableSchemes !== false;
  maxRows = Number.isFinite(Number(advanced?.schemeRows)) ? Number(advanced?.schemeRows) : 12;
  colorBySource = advanced?.colorBySource !== false;
  picks = await loadPicks();
  overrides = await getStageKindOverrides();
  // 本页被手动排除的前置关（识别不准时用「不是这关」写入）
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

  on("refreshBtn", "click", () => {
    void (async () => {
      await loadLocal();
      await loadResult();
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
  on("searchInput", "input", (e) => {
    query = (e.target as HTMLInputElement).value;
    applyFilters();
  });
  // 占用 chip 的「移除」：body 委托（占用清单面板已按需求移除，委托写法与它在不在无关）
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
