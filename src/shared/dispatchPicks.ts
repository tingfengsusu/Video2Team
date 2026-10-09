/**
 * §9.3 候选方案勾选 → 占用清单（派遣关方案选择的主路径）。
 *
 * 用户在候选池里勾选某关的一套方案 = 该方案干员被这一关占用：
 *   ① 写入 lockedOps（干员 → 关卡标签），同关**自动换选**（旧方案干员先释放）；
 *   ② `dispatchPicks`（关卡 → 已勾选方案）单独持久化，用于恢复勾选态与精确释放；
 *   ③ 取消勾选 → 移出 lockedOps，结果区颜色立即恢复（无需重新分析）。
 *
 * 释放只动「本关标签」下的干员：手动「加入占用清单」写入的其它关标签不受影响；
 * 同一干员同时出现在两关方案里时，释放后归属仍在勾选的另一关。
 */

import type { LockedOps } from "./types";
import { schemeKeyOf, type MergedStagePool } from "./dispatchPool";

export const PICKS_KEY = "dispatchPicks";

/** 一关已勾选的方案（key = schemeKeyOf；ops = 该方案固定干员） */
export interface DispatchPick {
  key: string;
  ops: string[];
  label: string; // 写入 lockedOps 的关卡标签
}

export type DispatchPicks = Record<string, DispatchPick>; // 显示码 → 勾选

/** 占用清单里的关卡标签（与手动「加入占用清单」同格式，便于去重与释放） */
export function stageLockLabel(displayCode: string, stageName?: string): string {
  const code = displayCode.trim();
  const name = (stageName ?? "").trim();
  return name ? `${code}（${name}）` : code;
}

/** 该占用标签是否指向本关（用于候选池里不置灰本关自己锁定的干员） */
export function isLockLabelOfStage(label: string | undefined, displayCode: string): boolean {
  const code = displayCode.trim().toUpperCase();
  if (!label || !code) return false;
  return label.toUpperCase().includes(code);
}

function uniqueOps(ops: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of ops) {
    const name = String(raw ?? "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

export interface RowPickInfo {
  stageCode: string;
  key: string;
  ops: string[];
  stageName?: string;
  /** 是否从结果对象里找到了对应方案（false = 走了 data-ops 兜底） */
  fromResult: boolean;
}

/**
 * 从候选池某一行的 DOM 解析勾选信息（三端共用）。
 *
 * 关键点：**不依赖"能在当前结果里查到方案"**——行上的 data-stage / data-scheme / data-ops 已足够完成勾选。
 * 之前只按 schemeKeyOf 查表，查不到就静默 return，会出现「勾选框被勾上但占用/置灰没变化」的假象
 * （旧结果缓存、键漂移等情况下都会命中）。
 */
export function resolvePickFromRow(
  input: HTMLElement,
  result: { dispatchGuides?: MergedStagePool[] } | null | undefined,
): RowPickInfo | null {
  const stageCode = (input.getAttribute("data-stage") ?? "").trim();
  const key = (input.getAttribute("data-scheme") ?? "").trim();
  if (!stageCode || !key) return null;
  const pool = (result?.dispatchGuides ?? []).find(
    (p) => p.displayCode.toUpperCase() === stageCode.toUpperCase(),
  );
  const scheme = pool?.schemes.find((s) => schemeKeyOf(s) === key);
  const rowOps = (input.closest("[data-pick-row='1']")?.getAttribute("data-ops") ?? "")
    .split("、")
    .map((x) => x.trim())
    .filter(Boolean);
  const ops = scheme?.operators?.length ? scheme.operators : rowOps;
  if (!ops.length) return null;
  return {
    stageCode: pool?.displayCode ?? stageCode,
    key,
    ops,
    stageName: pool?.stageName ?? scheme?.stageName,
    fromResult: !!scheme,
  };
}

export interface PickToggleInput {
  stageCode: string;
  stageName?: string;
  key: string;
  ops: readonly string[];
}

export interface PickOutcome {
  lockedOps: LockedOps;
  picks: DispatchPicks;
  checked: boolean; // 本次操作后的勾选态
}

/** 勾选/取消一关的一套方案，返回新的 lockedOps 与 picks（纯函数，便于离线验收）。 */
export function togglePick(
  lockedOps: LockedOps,
  picks: DispatchPicks,
  input: PickToggleInput,
): PickOutcome {
  const code = input.stageCode.trim().toUpperCase();
  const label = stageLockLabel(input.stageCode.trim(), input.stageName);
  const current = picks[code];
  const checked = !(current && current.key === input.key);

  const nextPicks: DispatchPicks = { ...picks };
  if (checked) nextPicks[code] = { key: input.key, label, ops: uniqueOps(input.ops) };
  else delete nextPicks[code];

  const nextLocks: LockedOps = { ...lockedOps };
  // 释放同关旧方案：仅移除仍指向本关的干员；被别的关同时占用则改挂那一关的标签
  for (const name of current?.ops ?? []) {
    if (!isLockLabelOfStage(nextLocks[name], code)) continue;
    const other = Object.entries(nextPicks).find(([c, p]) => c !== code && p.ops.includes(name));
    if (other) nextLocks[name] = other[1].label;
    else delete nextLocks[name];
  }
  if (checked) {
    for (const name of nextPicks[code]!.ops) nextLocks[name] = label;
  }
  return { lockedOps: nextLocks, picks: nextPicks, checked };
}

// ---------- 存储（chrome.storage.local；Node 自测时退化为内存） ----------

const memoryPicks: { value: DispatchPicks | null } = { value: null };

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local;
}

export async function loadPicks(): Promise<DispatchPicks> {
  if (!hasChromeStorage()) return memoryPicks.value ?? {};
  try {
    const stored = (await chrome.storage.local.get(PICKS_KEY)) as Record<string, DispatchPicks | undefined>;
    return stored[PICKS_KEY] ?? {};
  } catch {
    return {};
  }
}

export async function savePicks(picks: DispatchPicks): Promise<void> {
  if (!hasChromeStorage()) {
    memoryPicks.value = picks;
    return;
  }
  try {
    await chrome.storage.local.set({ [PICKS_KEY]: picks });
  } catch {
    /* 存储不可用：勾选态仅本次会话有效，锁定结果仍通过 lockedOps 生效 */
  }
}

/** 清空全部勾选（与「占用清单 → 清除全部」联动：清清单同时也应清勾选） */
export async function clearPicks(): Promise<void> {
  await savePicks({});
}
