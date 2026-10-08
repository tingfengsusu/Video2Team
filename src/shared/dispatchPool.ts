/**
 * §3 候选池合并：把两个数据源统一成同一种「派遣关候选方案」结构。
 *
 * - MAA 作业站（§2）：`opers[].name` 是游戏标准全名 → 标记「结构化」，可信度最高
 * - B站三级挖掘（§3）：实战视频标题/分P/简介 → 标记「实战视频」，带 bvid 溯源
 *
 * 合并规则（§3 验收「无重复干员方案错乱」）：
 *   同一关卡内，按**干员集合**（排序后）去重，重复时保留 MAA 结构化方案，
 *   避免同一套阵容同时以「结构化」和「实战视频」两条出现两次。
 */

import type { BiliScheme } from "./biliDig";
import { detectMode } from "./biliDig";
import type { DispatchStagePool, MaaScheme } from "./maa";

export type DispatchSourceKind = "maa" | "bili";

export interface PoolOper {
  name: string; // 游戏标准全名
  skill?: number;
  skillUsage?: number;
}

/** 合并后的单条候选方案（跨源统一结构） */
export interface MergedScheme {
  source: DispatchSourceKind;
  sourceLabel: string; // 「结构化」/「实战视频」（UI 直接展示）
  displayCode: string; // 显示码 VEC-SP07
  stageName: string; // 关卡中文名
  operators: string[]; // 固定干员全名（B站方案为字典校验后的全名）
  opers: PoolOper[]; // 含技能信息（MAA 才有；B站为空技能）
  mode: string; // 单人/双人/低星/挂机…（无则空串）
  title: string;
  details: string;
  author: string; // MAA uploader / B站 UP 主
  url: string; // 溯源链接（B站视频；MAA 无 → 空串）
  bvid: string; // 仅 B站来源（§7 点赞致谢用）
  copilotId?: number; // 仅 MAA 来源
  views: number;
  hotScore: number;
}

export interface MergedStagePool {
  displayCode: string;
  stageId: string;
  stageName: string;
  schemes: MergedScheme[];
  counts: { maa: number; bili: number }; // 各来源原始条数（去重前）
}

/** 干员集合签名：排序 + 去重 + 归一化空白（用于跨源去重） */
export function operatorSignature(operators: readonly string[]): string {
  const set = new Set<string>();
  for (const raw of operators) {
    const n = String(raw ?? "").trim();
    if (n) set.add(n);
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh")).join("+");
}

function fromMaa(scheme: MaaScheme, pool: DispatchStagePool): MergedScheme {
  const opers: PoolOper[] = scheme.opers.map((o) => ({
    name: o.name,
    skill: o.skill,
    skillUsage: o.skillUsage,
  }));
  const groupsText = scheme.groups
    .map((g) => `${g.name}: ${g.opers.map((o) => o.name).join("/")}`)
    .join("；");
  const details = [scheme.details, groupsText].filter(Boolean).join(" ｜ ");
  return {
    source: "maa",
    sourceLabel: "结构化",
    displayCode: pool.displayCode,
    stageName: pool.stageName,
    operators: opers.map((o) => o.name),
    opers,
    mode: detectMode(`${scheme.title} ${details}`),
    title: scheme.title || pool.stageName || pool.displayCode,
    details,
    author: scheme.uploader,
    url: "",
    bvid: "",
    copilotId: scheme.copilotId,
    views: scheme.views,
    hotScore: scheme.hotScore,
  };
}

function fromBili(scheme: BiliScheme, pool: { displayCode: string; stageName: string }): MergedScheme {
  return {
    source: "bili",
    sourceLabel: "实战视频",
    displayCode: pool.displayCode,
    stageName: pool.stageName,
    operators: [...scheme.operators],
    opers: scheme.operators.map((name) => ({ name })),
    mode: scheme.mode,
    title: scheme.title,
    details: "",
    author: scheme.author,
    url: scheme.url,
    bvid: scheme.bvid,
    views: 0,
    hotScore: 0,
  };
}

/**
 * 合并单关候选池：MAA 优先，B站补充同干员集合之外的新打法。
 * 输出排序：结构化在前（热度和播放量降序），实战视频在后（保持挖掘顺序）。
 */
export function mergeStagePool(
  pool: Pick<DispatchStagePool, "displayCode" | "stageId" | "stageName" | "schemes">,
  biliSchemes: readonly BiliScheme[] = [],
): MergedStagePool {
  const maaSorted = [...pool.schemes].sort(
    (a, b) => b.hotScore - a.hotScore || b.views - a.views,
  );
  const merged: MergedScheme[] = [];
  const seen = new Set<string>();
  const fullPool = pool as DispatchStagePool;

  for (const s of maaSorted) {
    const key = operatorSignature(s.opers.map((o) => o.name));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(fromMaa(s, fullPool));
  }
  for (const s of biliSchemes) {
    const key = operatorSignature(s.operators);
    if (!key || seen.has(key)) continue; // 与结构化重复的实战方案不再重复展示
    seen.add(key);
    merged.push(fromBili(s, pool));
  }

  return {
    displayCode: pool.displayCode,
    stageId: pool.stageId,
    stageName: pool.stageName,
    schemes: merged,
    counts: { maa: pool.schemes.length, bili: biliSchemes.length },
  };
}

/** 批量合并：按显示码对齐 MAA 池与 B站挖掘结果 */
export function mergePools(
  maaPools: readonly DispatchStagePool[],
  biliByStage: ReadonlyMap<string, readonly BiliScheme[]>,
): MergedStagePool[] {
  return maaPools.map((pool) => mergeStagePool(pool, biliByStage.get(pool.displayCode) ?? []));
}
