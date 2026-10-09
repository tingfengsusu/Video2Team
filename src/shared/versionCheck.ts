/**
 * 更新检查（第十五轮 q4 方案 3）。
 *
 * 仓库里放 `docs/version.json`（main 分支），插件启动时拉一次，与 `manifest.version` 比对：
 * 远端更新就在面板/设置页提示「发现新版 vX」，给出「打开仓库（更新说明）」与「复制升级步骤」。
 *
 * 与公告共用同一套策略：raw.githubusercontent 优先、jsdelivr 兜底、缓存 6 小时、
 * 拉不到就静默——更新提示不能影响任何主流程。用户点「忽略这个版本」后，同一个版本不再提示，
 * 只有更高的版本才会再提示。
 */
export interface RemoteVersion {
  version: string;
  date?: string;
  notes?: string[];
  releaseUrl?: string;
  steps?: string[];
}

import { fetchFirstJson, repoFileUrls } from "./remoteFile";

const CACHE_KEY = "versionCheckCache";
const IGNORE_KEY = "versionIgnored";
const TTL_MS = 6 * 60 * 60 * 1000;

const SOURCES = repoFileUrls("docs/version.json");

interface CacheEntry {
  ts: number;
  info: RemoteVersion;
}

/** 语义化版本比较：a>b → 1，a<b → -1，相等 → 0（只认数字段，非法段当 0） */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string): number[] =>
    String(v ?? "")
      .split(".")
      .map((s) => Number.parseInt(s.replace(/[^0-9].*$/, ""), 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const dx = x[i] ?? 0;
    const dy = y[i] ?? 0;
    if (dx !== dy) return dx > dy ? 1 : -1;
  }
  return 0;
}

/** 远端版本比本地新？ */
export function isNewerVersion(remote: string, local: string): boolean {
  return compareVersions(remote, local) > 0;
}

/** 校验/清洗远端 JSON（坏数据一律丢掉，绝不抛） */
export function parseVersionFile(raw: unknown): RemoteVersion | null {
  const o = raw as Partial<RemoteVersion> | null;
  const version = String(o?.version ?? "").trim();
  if (!/^\d+(\.\d+)*$/.test(version)) return null;
  const strList = (v: unknown): string[] | undefined => {
    const list = Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
    return list.length ? list : undefined;
  };
  return {
    version,
    date: o?.date ? String(o.date) : undefined,
    notes: strList(o?.notes),
    releaseUrl: o?.releaseUrl ? String(o.releaseUrl) : undefined,
    steps: strList(o?.steps),
  };
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const v = (await chrome.storage.local.get(CACHE_KEY)) as { [k: string]: CacheEntry | undefined };
    const entry = v[CACHE_KEY];
    return entry && entry.info ? entry : null;
  } catch {
    return null;
  }
}

async function ignoredVersions(): Promise<string[]> {
  try {
    const v = (await chrome.storage.local.get(IGNORE_KEY)) as { [k: string]: string[] | undefined };
    return Array.isArray(v[IGNORE_KEY]) ? v[IGNORE_KEY]! : [];
  } catch {
    return [];
  }
}

/** 记下"这个版本先不提示"（只有更高的版本才会再提示） */
export async function ignoreVersion(version: string): Promise<void> {
  const v = String(version ?? "").trim();
  if (!v) return;
  try {
    const list = await ignoredVersions();
    if (!list.includes(v)) await chrome.storage.local.set({ [IGNORE_KEY]: [...list, v] });
  } catch {
    /* 忽略 */
  }
}

async function fetchFromSources(): Promise<RemoteVersion | null> {
  return parseVersionFile(await fetchFirstJson(SOURCES));
}

/**
 * 检查更新：返回 { current, latest, hasUpdate, info|null }。
 * 拉不到远端时 hasUpdate=false（静默），current 取 manifest 版本。
 */
export async function checkForUpdate(
  opts: { force?: boolean } = {},
): Promise<{ current: string; latest: string | null; hasUpdate: boolean; info: RemoteVersion | null }> {
  const current = chrome.runtime.getManifest?.().version ?? "0.0.0";
  const cache = await readCache();
  const fresh = !!cache && Date.now() - cache.ts < TTL_MS;
  let info = cache?.info ?? null;
  if (opts.force || !fresh) {
    const fetched = await fetchFromSources();
    if (fetched) {
      info = fetched;
      try {
        await chrome.storage.local.set({ [CACHE_KEY]: { ts: Date.now(), info } satisfies CacheEntry });
      } catch {
        /* 缓存写失败无所谓 */
      }
    }
  }
  if (!info) return { current, latest: null, hasUpdate: false, info: null };
  const ignored = await ignoredVersions();
  const hasUpdate = isNewerVersion(info.version, current) && !ignored.includes(info.version);
  return { current, latest: info.version, hasUpdate, info };
}
