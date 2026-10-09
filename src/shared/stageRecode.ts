/**
 * 手动纠正派遣关识别（识别错了改关 / 漏识别补关）。
 *
 * 背景（2026-10-09 实测）：特别战线网格的「序号」要靠模型数行列，实测会漏格或错位
 * （如把第 12 格读成 11、两次完全没识别到）。名称多是补给名（催化装备…）又不在关卡库里，
 * 对不了账。因此给用户一个直接纠正的入口：每个前置关可「改成…」，列表底部可「补一个关」，
 * 后台按需现查该关的 MAA/B站 方案。
 */
import type { AnalysisOutput } from "./types";
import type { MergedStagePool } from "./dispatchPool";

export const STAGE_SKIPS_KEY = "dispatchStageSkips";

/** 按显示码现查一关的候选池（后台 MAA + B站；失败返回 null） */
export async function queryStagePool(displayCode: string): Promise<MergedStagePool | null> {
  try {
    const resp = (await chrome.runtime.sendMessage({
      type: "DISPATCH_QUERY_STAGE",
      displayCode,
    })) as { ok?: boolean; pool?: MergedStagePool | null } | undefined;
    return resp?.ok && resp.pool ? resp.pool : null;
  } catch {
    return null;
  }
}

/** 把候选池替换（from 为空则追加）进结果，返回新结果对象（不改原对象） */
export function patchStagePool(
  result: AnalysisOutput,
  from: string | null,
  pool: MergedStagePool,
): AnalysisOutput {
  const guides = [...(result.dispatchGuides ?? [])];
  const fromCode = (from ?? "").toUpperCase();
  const i = fromCode
    ? guides.findIndex((p) => p.displayCode.toUpperCase() === fromCode)
    : -1;
  if (i >= 0) guides[i] = pool;
  else guides.push(pool);
  return { ...result, dispatchGuides: guides };
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
