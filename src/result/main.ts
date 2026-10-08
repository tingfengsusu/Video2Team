/**
 * 结果大窗口页（chrome.windows.create 的 popup 窗口，~900px）：
 * 与视频页面板 / popup 共用同一份 `renderResult`，但一次性把「本关阵容 + 前置关候选池 + 占用清单」铺开，抄作业时不用在小面板里滚。
 *
 * 数据来源：
 * - 结果本体：`storage.session.bigResult`（面板点「⤢ 大窗口」时写入）
 * - 占用清单 / 勾选态 / 练度表 / 关卡类型覆盖：`storage.local`（与面板共用，**双向实时同步**）
 */
import type { AnalysisOutput, Box, LockedOps } from "../shared/types";
import { esc, renderResult, renderLockedSection, type HasOp } from "../shared/render";
import { loadPicks, togglePick, type DispatchPicks } from "../shared/dispatchPicks";
import { schemeKeyOf } from "../shared/dispatchPool";
import { isAmbiguousStageResolution, resolveStageKind, type StageKindOverrides } from "../shared/stageKind";
import { getStageKindOverrides } from "../shared/stageKind";

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

function renderLocks(): void {
  $("locks").innerHTML = renderLockedSection(lockedOps);
  const n = Object.keys(lockedOps).length;
  $("lockCount").textContent = n ? `（${n} 人）` : "";
}

function render(): void {
  if (!current) {
    $("result").innerHTML = `<div class="hint">还没有结果：回到B站视频页打开面板 → 分析 → 点「⤢ 大窗口查看」。</div>`;
    $("headline").textContent = "";
    return;
  }
  const kind = resolveStageKind(current.stage, current.videoTitle, overrides);
  const ambiguous = isAmbiguousStageResolution(current.stageResolution);
  $("headline").textContent = `${current.stage} ｜ ${current.videoTitle}`;
  $("result").innerHTML = renderResult(current, hasOp, lockedOps, {
    stageKind: kind.kind,
    allowDispatchSwitch: kind.kind === "unknown" && !ambiguous,
    ambiguousDispatch: ambiguous,
    picks,
    hideUnavailable,
    maxSchemeRows: maxRows,
  });
}

async function loadLocal(): Promise<void> {
  const { box, lockedOps: lo, advanced } = (await chrome.storage.local.get([
    "box",
    "lockedOps",
    "advanced",
  ])) as {
    box?: Box;
    lockedOps?: LockedOps;
    advanced?: { hideUnavailableSchemes?: boolean; schemeRows?: number };
  };
  hasOp = (n) => !!box?.operators[n];
  lockedOps = lo ?? {};
  hideUnavailable = advanced?.hideUnavailableSchemes !== false; // 默认开
  maxRows = Number.isFinite(Number(advanced?.schemeRows)) ? Number(advanced?.schemeRows) : 12;
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
      ? `结果时间：${new Date(payload.ts).toLocaleString()}（勾选/取消勾选会实时同步到这个窗口与视频页面板）`
      : "";
  } catch {
    current = null;
    $("status").innerHTML = `<span class="err">读取结果失败（storage.session 不可用）</span>`;
  }
}

/** 候选池勾选：与大窗口共用同一套 lockedOps / dispatchPicks，双向同步 */
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
  $("result").addEventListener("change", (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.matches?.('input[data-pick="1"]')) void onPickChange(target as HTMLInputElement);
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
    if (changes.lockedOps ?? changes.dispatchPicks ?? changes.box ?? changes.advanced ?? changes.stageKindOverrides) {
      void (async () => {
        await loadLocal();
        renderLocks();
        render();
      })();
    }
  });
}

void init();
