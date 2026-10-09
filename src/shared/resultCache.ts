/**
 * 分P级分析结果缓存。
 *
 * key = bvid:page（独立视频统一为 page=0），最多保留 30 条，7 天过期。
 * 读缓存会刷新 LRU 访问时间，但展示时间仍使用首次分析完成时间 ts。
 */

import type { AnalysisOutput } from "./types";

export interface ResultCacheEntry {
  ts: number;
  result: AnalysisOutput;
  videoTitle: string;
  lastAccess?: number;
}

export type ResultCache = Record<string, ResultCacheEntry>;

export const RESULT_CACHE_KEY = "resultCache";
export const RESULT_CACHE_MAX = 30;
export const RESULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** 独立视频没有 ?p=，统一归一为 0，避免 null/undefined 产生不同 key。 */
export function normalizePage(page: number | null | undefined): number {
  return page && page > 0 ? page : 0;
}

export function resultCacheKey(bvid: string, page: number | null | undefined): string {
  return `${bvid}:${normalizePage(page)}`;
}

function pruneCache(cache: ResultCache, now: number): { cache: ResultCache; changed: boolean } {
  let changed = false;
  const live = Object.entries(cache).filter(([, entry]) => {
    const valid =
      entry &&
      typeof entry.ts === "number" &&
      !!entry.result &&
      now - entry.ts <= RESULT_CACHE_TTL_MS;
    if (!valid) changed = true;
    return valid;
  });
  live.sort(
    (a, b) =>
      (b[1].lastAccess ?? b[1].ts) - (a[1].lastAccess ?? a[1].ts),
  );
  if (live.length > RESULT_CACHE_MAX) changed = true;
  return { cache: Object.fromEntries(live.slice(0, RESULT_CACHE_MAX)), changed };
}

async function readCache(): Promise<ResultCache> {
  const stored = (await chrome.storage.local.get(RESULT_CACHE_KEY)) as Record<string, ResultCache>;
  return stored[RESULT_CACHE_KEY] ?? {};
}

/** 读取指定视频/分P的缓存；过期与超限条目会自动清理。 */
export async function getCachedResult(
  bvid: string,
  page: number | null | undefined,
): Promise<ResultCacheEntry | null> {
  const now = Date.now();
  const cache = await readCache();
  const pruned = pruneCache(cache, now);
  const key = resultCacheKey(bvid, page);
  const entry = pruned.cache[key];
  if (entry) {
    entry.lastAccess = now;
  }
  if (pruned.changed || entry) {
    await chrome.storage.local.set({ [RESULT_CACHE_KEY]: pruned.cache });
  }
  return entry ?? null;
}

/** 分析完成后写入缓存，并按 LRU 淘汰到 30 条以内。 */
export async function putCachedResult(
  result: AnalysisOutput,
  page: number | null | undefined = result.roster.page,
): Promise<void> {
  const now = Date.now();
  const cache = await readCache();
  const pruned = pruneCache(cache, now).cache;
  const key = resultCacheKey(result.bvid, page);
  pruned[key] = {
    ts: now,
    result,
    videoTitle: result.videoTitle,
    lastAccess: now,
  };
  const final = pruneCache(pruned, now).cache;
  await chrome.storage.local.set({ [RESULT_CACHE_KEY]: final });
}

export async function clearResultCache(): Promise<void> {
  await chrome.storage.local.remove(RESULT_CACHE_KEY);
}

/** 只清一个视频/分P的缓存（面板上的「清除本页缓存」）：换视频或想重新分析时用得上 */
export async function clearCachedResult(
  bvid: string,
  page: number | null | undefined,
): Promise<boolean> {
  const key = resultCacheKey(bvid, normalizePage(page));
  const cache = await readCache();
  if (!(key in cache)) return false;
  delete cache[key];
  await chrome.storage.local.set({ [RESULT_CACHE_KEY]: cache });
  return true;
}
