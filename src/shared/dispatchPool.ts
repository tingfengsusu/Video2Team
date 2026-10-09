/**
 * §3 候选池合并：把两个数据源统一成同一种「派遣关候选方案」结构。
 *
 * - MAA 作业站（§2）：`opers[].name` 是游戏标准全名 → 标记「MAA作业」，可信度最高
 * - B站三级挖掘（§3）：实战视频标题/分P/简介 → 标记「B站视频」，带 bvid 溯源
 *
 * 合并规则（§3 验收「无重复干员方案错乱」）：
 *   同一关卡内，按**干员集合**（排序后）去重，重复时保留 MAA 方案，
 *   避免同一套阵容同时以「MAA作业」和「B站视频」两条出现两次。
 *
 * §9.1：标签用「MAA作业 / B站视频」（原「结构化 / 实战」不易理解），计数与悬停说明同源。
 * §9.2：方案来源可点击 —— MAA → prts.plus 作业详情页，B站 → 视频页（新标签打开）。
 */

import type { BiliScheme } from "./biliDig";
import { detectMode } from "./biliDig";
import type { DispatchStagePool, MaaScheme } from "./maa";

export type DispatchSourceKind = "maa" | "bili";

/** 数据源标签（§9.1：原「结构化 / 实战」改为「MAA作业 / B站视频」） */
export const SOURCE_LABELS: Record<DispatchSourceKind, string> = {
  maa: "MAA作业",
  bili: "B站视频",
};

/** 计数处 title 悬停说明（§9.1） */
export const SOURCE_TIPS: Record<DispatchSourceKind, string> = {
  maa: "MAA 作业站（prts.plus）的结构化方案",
  bili: "B站攻略视频挖掘",
};

/**
 * MAA 作业站站点；作业详情路由实测为 `/operation/{id}`
 * （2026-10-08 验证：旧版 `/copilot/{id}` 在现版本不存在，落 404）。
 */
export const MAA_SITE = "https://prts.plus";

/** 作业详情页链接（无 id 时退回作业站首页）。 */
export function maaOperationUrl(copilotId?: number): string {
  const id = Math.trunc(Number(copilotId) || 0);
  return id > 0 ? `${MAA_SITE}/operation/${id}` : `${MAA_SITE}/`;
}

/**
 * 该关作业列表页（§9.2）：prts.plus **不支持按关直链**（筛选状态存本地，`?levelKeyword=` 不生效，已实测），
 * 因此链接到作业站首页，由页面「关卡」筛选/搜索框输入显示码定位该关。
 */
export function maaLevelUrl(): string {
  return `${MAA_SITE}/`;
}

/** B站视频页链接（新标签打开用）。 */
export function biliVideoUrl(bvid: string): string {
  const id = String(bvid ?? "").trim();
  return id ? `https://www.bilibili.com/video/${id}` : "";
}

export interface PoolOper {
  name: string; // 游戏标准全名
  skill?: number;
  skillUsage?: number;
}

/** 合并后的单条候选方案（跨源统一结构） */
export interface MergedScheme {
  source: DispatchSourceKind;
  sourceLabel: string; // §9.1：「MAA作业」/「B站视频」（UI 直接展示）
  displayCode: string; // 显示码 VEC-SP07
  stageName: string; // 关卡中文名
  operators: string[]; // 固定干员全名（B站方案为字典校验后的全名）
  opers: PoolOper[]; // 含技能信息（MAA 才有；B站为空技能）
  mode: string; // 单人/双人/低星/挂机…（无则空串）
  title: string;
  details: string;
  author: string; // MAA uploader / B站 UP 主
  url: string; // 溯源链接（B站视频，含 ?p= 分P；MAA 无 → 空串）
  bvid: string; // 仅 B站来源（§7 点赞致谢用）
  page?: number; // 仅 B站来源：分P 序号（>1 时链接带 ?p=，UI 标注「分P」）
  collection?: string; // 仅 B站来源：所属合集标题（悬停溯源）
  copilotId?: number; // 仅 MAA 来源
  views: number;
  hotScore: number;
}

/** 方案来源链接（§9.2）：MAA → 作业详情页；B站 → 视频页。 */
export function schemeSourceUrl(scheme: MergedScheme): string {
  if (scheme.source === "maa") return maaOperationUrl(scheme.copilotId);
  if (scheme.url && /^https?:\/\//i.test(scheme.url)) return scheme.url;
  return biliVideoUrl(scheme.bvid);
}

/** 方案在候选池中的稳定标识（§9.3 勾选态持久化用） */
export function schemeKeyOf(scheme: MergedScheme): string {
  if (scheme.source === "maa") {
    return scheme.copilotId
      ? `maa:${scheme.copilotId}`
      : `maa:${operatorSignature(scheme.operators)}`;
  }
  return `bili:${scheme.bvid || operatorSignature(scheme.operators)}`;
}

export interface MergedStagePool {
  displayCode: string;
  stageId: string;
  stageName: string;
  schemes: MergedScheme[];
  counts: { maa: number; bili: number; dup?: number }; // 各来源原始条数（去重前）+ 被按阵容去重掉的条数
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
    sourceLabel: SOURCE_LABELS.maa,
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
    sourceLabel: SOURCE_LABELS.bili,
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
    page: scheme.page,
    collection: scheme.collection,
    views: 0,
    hotScore: 0,
  };
}

/**
 * 合并单关候选池：MAA 优先，B站补充同干员集合之外的新打法。
 * 输出排序：MAA作业在前（热度和播放量降序），B站视频在后（保持挖掘顺序）。
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
  let dup = 0; // 被"同阵容"去重掉的条数（用户实测会问"怎么比之前少了"，显示出来）

  for (const s of maaSorted) {
    const key = operatorSignature(s.opers.map((o) => o.name));
    if (!key || seen.has(key)) {
      if (key) dup += 1;
      continue;
    }
    seen.add(key);
    merged.push(fromMaa(s, fullPool));
  }
  for (const s of biliSchemes) {
    const key = operatorSignature(s.operators);
    if (!key || seen.has(key)) {
      if (key) dup += 1; // 与 MAA 作业（或别的实战方案）重复的不再重复展示
      continue;
    }
    seen.add(key);
    merged.push(fromBili(s, pool));
  }

  return {
    displayCode: pool.displayCode,
    stageId: pool.stageId,
    stageName: pool.stageName,
    schemes: merged,
    counts: { maa: pool.schemes.length, bili: biliSchemes.length, dup },
  };
}

/** 批量合并：按显示码对齐 MAA 池与 B站挖掘结果 */
export function mergePools(
  maaPools: readonly DispatchStagePool[],
  biliByStage: ReadonlyMap<string, readonly BiliScheme[]>,
): MergedStagePool[] {
  return maaPools.map((pool) => mergeStagePool(pool, biliByStage.get(pool.displayCode) ?? []));
}
