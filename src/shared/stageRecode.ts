/**
 * 手动纠正派遣关识别（漏识别补关）。
 *
 * 背景（2026-10-09 实测）：特别战线网格的「序号」要靠模型数行列，实测会漏格或错位
 * （如把第 12 格读成 11、两次完全没识别到）。名称多是补给名（催化装备…）又不在关卡库里，
 * 对不了账。因此给用户一个直接纠正的入口：结果区底部「＋ 补一个关…」，后台按需现查该关的 MAA/B站 方案。
 */
import type { AnalysisOutput } from "./types";
import type { MergedStagePool } from "./dispatchPool";
import { chainMapFor } from "./constants";

export const STAGE_SKIPS_KEY = "dispatchStageSkips";

/** 按显示码现查一关的候选池（后台 MAA + B站；失败返回 null） */
export async function queryStagePools(
  displayCodes: readonly string[],
): Promise<MergedStagePool[]> {
  const codes = displayCodes.map((c) => String(c ?? "").trim().toUpperCase()).filter(Boolean);
  if (!codes.length) return [];
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "DISPATCH_QUERY_STAGE",
      displayCodes: codes,
    })) as
      | { ok?: boolean; pools?: MergedStagePool[]; pool?: MergedStagePool | null }
      | undefined;
    if (!resp?.ok) return [];
    const pools = resp.pools ?? (resp.pool ? [resp.pool] : []);
    return pools.filter((p): p is MergedStagePool => !!p);
  } catch {
    return [];
  }
}

/** 按显示码现查一关的候选池（等价于 queryStagePools 的第一个） */
export async function queryStagePool(displayCode: string): Promise<MergedStagePool | null> {
  const pools = await queryStagePools([displayCode]);
  return pools[0] ?? null;
}

/** 把候选池并入结果：同显示码的替换（刷新），否则追加（不改原对象） */
export function patchStagePool(result: AnalysisOutput, pool: MergedStagePool): AnalysisOutput {
  const guides = [...(result.dispatchGuides ?? [])];
  const code = pool.displayCode.toUpperCase();
  const i = guides.findIndex((p) => p.displayCode.toUpperCase() === code);
  if (i >= 0) guides[i] = pool;
  else guides.push(pool);
  return { ...result, dispatchGuides: guides };
}

/** 把多关候选池并入结果：按**本活动的序号**排回去（第十二轮 p1：新加的关要落在它对应的序号位置，
 *  而不是一律追加到末尾），并同步「关卡链」说明（手动补关也要带上链条）。 */
export function patchStagePools(
  result: AnalysisOutput,
  pools: readonly MergedStagePool[],
): AnalysisOutput {
  const next = pools.reduce<AnalysisOutput>((acc, pool) => patchStagePool(acc, pool), result);
  const order = new Map(
    (result.dispatchStageOptions ?? []).map((o, i) => [o.displayCode.toUpperCase(), i]),
  );
  const guides = [...(next.dispatchGuides ?? [])];
  // 稳定排序：清单里没有的关（理论上不该有）排在后面并保持原有相对顺序
  guides.sort(
    (a, b) =>
      (order.get(a.displayCode.toUpperCase()) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.displayCode.toUpperCase()) ?? Number.MAX_SAFE_INTEGER),
  );
  return {
    ...next,
    dispatchGuides: guides,
    dispatchStageChain: chainMapFor(guides.map((p) => p.displayCode)),
  };
}

/** 取消某关的「不是这关」排除记录（改/补关后应能正常显示） */
export async function clearStageSkip(key: string, displayCode: string): Promise<void> {
  try {
    const stored = (await chrome.storage.local.get(STAGE_SKIPS_KEY)) as Record<
      string,
      Record<string, string[]> | undefined
    >;
    const all = { ...(stored[STAGE_SKIPS_KEY] ?? {}) };
    const cur = new Set(all[key] ?? []);
    if (!cur.delete(displayCode.toUpperCase())) return;
    all[key] = [...cur];
    await chrome.storage.local.set({ [STAGE_SKIPS_KEY]: all });
  } catch {
    /* 忽略：排除记录清理失败不影响主流程 */
  }
}
