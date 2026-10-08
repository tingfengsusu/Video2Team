/**
 * P1 派遣关攻略查询：把黄色格映射出的 VEC-SPxx 自动送到两个数据源。
 *
 * MAA 采用一次活动前缀查询拿到全部结构化作业；B站只对 MAA 方案较薄的
 * 候选关做标题搜索，且默认只走干员字典，避免主分析后再次产生 LLM 费用。
 */

import { buildDispatchPool, eventPrefixFromStageId } from "./maa";
import { mineStageWithLlm, type BiliScheme, type NameDict } from "./biliDig";
import { mergePools, type MergedStagePool } from "./dispatchPool";
import type { StageGridCandidate } from "./types";

export interface BuildDispatchGuidesOptions {
  perStageLimit?: number;
  maxPages?: number;
  mineBili?: boolean;
  maxBiliStages?: number;
  thinThreshold?: number;
}

function uniqueCandidates(candidates: readonly StageGridCandidate[]): StageGridCandidate[] {
  const seen = new Set<string>();
  const out: StageGridCandidate[] = [];
  for (const candidate of candidates) {
    const code = candidate.displayCode.trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(candidate);
  }
  return out.sort((a, b) =>
    a.displayCode.localeCompare(b.displayCode, "en", { numeric: true }),
  );
}

/** 根据 P1 黄色格候选查询攻略；无网络/无结果时返回带空方案池的候选列表。 */
export async function buildDispatchGuides(
  candidates: readonly StageGridCandidate[],
  dict: NameDict,
  options: BuildDispatchGuidesOptions = {},
): Promise<MergedStagePool[]> {
  const selected = uniqueCandidates(candidates);
  if (selected.length === 0) return [];

  const prefix = selected[0]?.stageId
    ? eventPrefixFromStageId(selected[0].stageId)
    : "";
  const maaPools = prefix
    ? await buildDispatchPool(prefix, {
        perStageLimit: options.perStageLimit ?? 5,
        maxPages: options.maxPages ?? 4,
      }).catch(() => [])
    : [];
  const maaByCode = new Map(maaPools.map((pool) => [pool.displayCode.toUpperCase(), pool]));

  const pools = selected.map((candidate) => {
    const pool = maaByCode.get(candidate.displayCode.toUpperCase());
    return (
      pool ?? {
        displayCode: candidate.displayCode,
        stageId: candidate.stageId,
        stageName: candidate.stageName,
        schemes: [],
      }
    );
  });

  const biliByStage = new Map<string, BiliScheme[]>();
  const thinThreshold = Math.max(1, options.thinThreshold ?? 2);
  const maxBiliStages = Math.max(0, options.maxBiliStages ?? selected.length);
  if (options.mineBili !== false && maxBiliStages > 0) {
    const targets = pools
      .filter((pool) => pool.schemes.length < thinThreshold)
      .slice(0, maxBiliStages);
    for (const pool of targets) {
      try {
        const result = await mineStageWithLlm(pool.displayCode, dict, {
          pages: 1,
          maxPartsVideos: 1,
          maxDescVideos: 0,
          ask: null, // 自动补充只按标题/字典匹配，避免二次 LLM 调用
        });
        if (!result.failed && result.schemes.length) {
          biliByStage.set(pool.displayCode, result.schemes);
        }
      } catch {
        // 单关 B站搜索失败不影响其它候选关和当前分析。
      }
    }
  }

  return mergePools(pools, biliByStage);
}
