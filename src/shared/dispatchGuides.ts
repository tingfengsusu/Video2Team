/**
 * P1 派遣关攻略查询：把黄色格映射出的 VEC-SPxx 自动送到两个数据源。
 *
 * MAA 采用一次活动前缀查询拿到全部结构化作业；B站按**每关**搜索标题与分P，
 * **全程只用干员字典 + 别名表程序化提取**（`ask: null`，不产生 LLM 费用）。
 *
 * v4.3 二次反馈（q1）：「只有 MAA 方案不足的关才挖 B站」太局限——B站攻略基数更大，
 * 默认改为**全部候选关都挖**，并可通过高级设置调节范围（全部/仅薄关/关闭）与每关搜索页数；
 * 分P 层强制必拉（最有信息量的一层），挖掘结果按 12h 缓存，避免重复分析重复请求与风控。
 */

import { buildDispatchPool, eventPrefixFromStageId } from "./maa";
import { mineStageWithLlm, type BiliScheme, type NameDict } from "./biliDig";
import { mergePools, type MergedStagePool } from "./dispatchPool";
import type { StageGridCandidate } from "./types";

/** B站挖掘范围：全部候选关 / 仅 MAA 方案不足的关 / 关闭 */
export type BiliMineScope = "all" | "thin" | "off";

export interface BuildDispatchGuidesOptions {
  perStageLimit?: number;
  maxPages?: number; // MAA 前缀查询翻页上限
  /** 直接关闭 B站挖掘（等价于 biliScope: "off"，保留旧调用签名） */
  mineBili?: boolean;
  biliScope?: BiliMineScope; // 默认 "all"
  biliPages?: number; // 每关搜索页数（默认 2，1-5）
  /** 只要最近 N 天发布的视频（默认 180；0 = 不限）——挡掉上一期活动的旧攻略 */
  biliMaxAgeDays?: number;
  maxBiliStages?: number; // 最多挖几关（默认 = 候选关数）
  thinThreshold?: number; // scope = "thin" 时的「方案不足」阈值（默认 2）
  maxPartsVideos?: number; // 每关拉几个合集的分P 标题（默认 3）
  maxDescVideos?: number; // 每关额外拉几个简介（默认 0：搜索结果自带简介，够用）
  cacheTtlMs?: number; // B站挖掘结果缓存时长（默认 12h）
}

export interface DispatchGuidesStats {
  biliScope: BiliMineScope;
  biliPages: number;
  biliMaxAgeDays: number;
  biliMined: number; // 实际产出结果的关数（含缓存命中）
  biliCached: number; // 其中由缓存直接命中的关数
  biliFailed: number; // 搜索失败（断网/风控）的关数
  biliHits: number; // 挖掘出的方案条数（跨源去重前）
  biliShown: number; // 合并去重后真正展示的 B站方案条数
  biliSkipped: number; // 因不指向本关（合集标题/其它关分P）被排除的语料条数
  biliExpired: number; // 因超出时间范围（上一期活动等）被排除的搜索结果条数
}

export interface DispatchGuidesBuildResult {
  pools: MergedStagePool[];
  stats: DispatchGuidesStats;
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

export interface SelectBiliTargetsOptions {
  scope: BiliMineScope;
  thinThreshold?: number;
  maxStages?: number;
}

/**
 * 选出要做 B站挖掘的关卡（纯函数，便于离线验收）：
 * - all：全部候选关（默认，B站攻略基数更大 → 召回优先）
 * - thin：仅 MAA 方案数 < thinThreshold 的关（旧行为）
 * - off：不挖
 * maxStages 只截断「参与挖掘」的关数，不影响这些关在结果里展示。
 */
export function selectBiliTargets(
  pools: readonly { displayCode: string; stageName?: string; schemes: readonly unknown[] }[],
  opts: SelectBiliTargetsOptions,
): { displayCode: string; stageName?: string }[] {
  if (opts.scope === "off") return [];
  const thinThreshold = Math.max(1, opts.thinThreshold ?? 2);
  const maxStages = Math.max(0, opts.maxStages ?? Number.POSITIVE_INFINITY);
  const eligible =
    opts.scope === "thin" ? pools.filter((pool) => pool.schemes.length < thinThreshold) : pools;
  return eligible
    .slice(0, maxStages)
    .map((pool) => ({ displayCode: pool.displayCode, stageName: pool.stageName }));
}

// ---------- B站挖掘结果缓存（避免重复分析重复请求 + 降低风控概率） ----------

const BILI_CACHE_KEY = "biliMineCache";
const DEFAULT_CACHE_TTL_MS = 12 * 3600 * 1000;

interface BiliCacheEntry {
  ts: number;
  schemes: BiliScheme[];
}

const memoryCache: { value: Record<string, BiliCacheEntry> | null } = { value: null };

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local;
}

async function readCache(): Promise<Record<string, BiliCacheEntry>> {
  if (!hasChromeStorage()) return memoryCache.value ?? {};
  try {
    const stored = (await chrome.storage.local.get(BILI_CACHE_KEY)) as Record<
      string,
      Record<string, BiliCacheEntry> | undefined
    >;
    return stored[BILI_CACHE_KEY] ?? {};
  } catch {
    return {};
  }
}

async function writeCache(cache: Record<string, BiliCacheEntry>): Promise<void> {
  if (!hasChromeStorage()) {
    memoryCache.value = cache;
    return;
  }
  try {
    await chrome.storage.local.set({ [BILI_CACHE_KEY]: cache });
  } catch {
    /* 缓存写失败不影响结果 */
  }
}

function cacheKeyOf(displayCode: string, pages: number, maxPartsVideos: number, maxAgeDays: number): string {
  return `${displayCode.toUpperCase()}|p${pages}|v${maxPartsVideos}|age${maxAgeDays}`;
}

/** 清空 B站挖掘缓存（设置页「清空分析缓存」一并调用） */
export async function clearBiliMineCache(): Promise<void> {
  memoryCache.value = null;
  if (hasChromeStorage()) await chrome.storage.local.remove(BILI_CACHE_KEY).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 结果区那行「B站挖掘：…」文案（无挖掘/关闭时返回空串） */
export function biliMiningNote(stats: DispatchGuidesStats): string {
  if (stats.biliScope === "off") return "";
  if (stats.biliMined === 0 && stats.biliFailed === 0) return "";
  const parts = [
    `B站挖掘：${stats.biliMined} 关 · 命中 ${stats.biliHits} 条`,
    stats.biliCached ? `（缓存 ${stats.biliCached} 关）` : "",
    stats.biliFailed ? `（${stats.biliFailed} 关搜索失败）` : "",
  ];
  const tail: string[] = [];
  const deduped = stats.biliHits - stats.biliShown;
  if (deduped > 0) tail.push(`${deduped} 条与 MAA 方案同阵容已去重`);
  if (stats.biliSkipped > 0) tail.push(`已排除 ${stats.biliSkipped} 条合集/他关语料`);
  if (stats.biliExpired > 0) {
    const window = stats.biliMaxAgeDays > 0 ? `${stats.biliMaxAgeDays} 天外的` : "过期";
    tail.push(`已排除 ${stats.biliExpired} 条${window}旧视频`);
  }
  return parts.filter(Boolean).join("") + (tail.length ? `；${tail.join("、")}` : "");
}

export function emptyGuidesStats(
  scope: BiliMineScope = "all",
  pages = 2,
  maxAgeDays = 180,
): DispatchGuidesStats {
  return {
    biliScope: scope,
    biliPages: pages,
    biliMaxAgeDays: maxAgeDays,
    biliMined: 0,
    biliCached: 0,
    biliFailed: 0,
    biliHits: 0,
    biliShown: 0,
    biliSkipped: 0,
    biliExpired: 0,
  };
}

/**
 * 根据 P1 黄色格候选查询攻略；无网络/无结果时返回带空方案池的候选列表。
 * 返回 `{ pools, stats }`：stats 供结果区展示「B站挖掘 N 关 · 命中 M 条」。
 */
export async function buildDispatchGuides(
  candidates: readonly StageGridCandidate[],
  dict: NameDict,
  options: BuildDispatchGuidesOptions = {},
): Promise<DispatchGuidesBuildResult> {
  const selected = uniqueCandidates(candidates);
  const scope: BiliMineScope =
    options.biliScope ?? (options.mineBili === false ? "off" : "all");
  const biliPages = Math.max(1, Math.min(5, Math.trunc(options.biliPages ?? 2)));
  const biliMaxAgeDays = Math.max(0, Math.trunc(options.biliMaxAgeDays ?? 180));
  const stats = emptyGuidesStats(scope, biliPages, biliMaxAgeDays);
  if (selected.length === 0) return { pools: [], stats };

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

  // ---------- B站补充（默认全关） ----------
  const maxPartsVideos = Math.max(0, options.maxPartsVideos ?? 3);
  const maxDescVideos = Math.max(0, options.maxDescVideos ?? 0);
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
  const targets = selectBiliTargets(pools, {
    scope,
    thinThreshold: options.thinThreshold ?? 2,
    maxStages: options.maxBiliStages,
  });
  const biliByStage = new Map<string, BiliScheme[]>();
  if (targets.length) {
    const cache = await readCache();
    const now = Date.now();
    let cacheDirty = false;
    for (const target of targets) {
      const code = target.displayCode;
      const key = cacheKeyOf(code, biliPages, maxPartsVideos, biliMaxAgeDays);
      const hit = cache[key];
      if (hit && now - hit.ts < cacheTtlMs) {
        stats.biliMined += 1;
        stats.biliCached += 1;
        stats.biliHits += hit.schemes.length;
        if (hit.schemes.length) biliByStage.set(code, hit.schemes);
        continue;
      }
      try {
        const result = await mineStageWithLlm(code, dict, {
          pages: biliPages,
          maxPartsVideos,
          maxDescVideos,
          maxAgeDays: biliMaxAgeDays, // 挡掉上一期活动的旧攻略
          partsThreshold: Number.POSITIVE_INFINITY, // 分P 一层的「关卡+干员」对信息量最高，必拉
          // 关卡归属：合集大标题/其它关的分P 不采纳（避免整合集干员并集当本关阵容）
          stageHint: { displayCode: target.displayCode, stageName: target.stageName },
          ask: null, // 程序化提取：干员字典 + 别名表，不花 token
        });
        if (result.failed) {
          stats.biliFailed += 1;
        } else {
          stats.biliMined += 1;
          stats.biliHits += result.schemes.length;
          stats.biliSkipped += result.stats.skippedEntries;
          stats.biliExpired += result.stats.expiredSkipped;
          cache[key] = { ts: now, schemes: result.schemes };
          cacheDirty = true;
          if (result.schemes.length) biliByStage.set(code, result.schemes);
        }
      } catch {
        stats.biliFailed += 1; // 单关失败不影响其它关与当前分析
      }
      await sleep(250); // 顺序 + 轻微间隔，降低风控概率
    }
    if (cacheDirty) await writeCache(cache);
  }

  const merged = mergePools(pools, biliByStage);
  stats.biliShown = merged.reduce(
    (n, pool) => n + pool.schemes.filter((scheme) => scheme.source === "bili").length,
    0,
  );
  return { pools: merged, stats };
}
