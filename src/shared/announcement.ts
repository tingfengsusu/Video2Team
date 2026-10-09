/**
 * 启动时读公告（第十五轮 q3）。
 *
 * 公告就是仓库里的一个文件：`docs/announcement.json`（main 分支）。插件启动/打开面板时拉一次，
 * 缓存 6 小时，同一台机器只用最省事的那条路：
 *   ① raw.githubusercontent.com（GitHub 官方）
 *   ② cdn.jsdelivr.net（国内常被墙时更稳，同一份文件）
 * 每条公告有稳定 id，用户点「知道了」后记进 storage.local，不再重复弹。
 *
 * 设计要点：**拉不到就用缓存、缓存也没有就静默**——公告不该影响任何主流程。
 */
export type AnnouncementLevel = "info" | "warn";

export interface AnnouncementItem {
  id: string;
  date?: string;
  level?: AnnouncementLevel;
  title: string;
  body: string;
}

import { effectiveFileUrls, fetchFirstJson } from "./remoteFile";

const CACHE_KEY = "announcementCache";
const READ_KEY = "announcementRead";
const TTL_MS = 6 * 60 * 60 * 1000;

const REMOTE_PATH = "docs/announcement.json";

interface CacheEntry {
  ts: number;
  items: AnnouncementItem[];
}

/** 校验/清洗远端 JSON（只认形状对的部分，坏数据一律丢掉，绝不抛） */
export function parseAnnouncement(raw: unknown): AnnouncementItem[] {
  const obj = raw as { items?: unknown } | null;
  const list = Array.isArray(obj?.items) ? obj.items : [];
  const out: AnnouncementItem[] = [];
  for (const it of list) {
    const o = it as Partial<AnnouncementItem> | null;
    const id = String(o?.id ?? "").trim();
    const title = String(o?.title ?? "").trim();
    const body = String(o?.body ?? "").trim();
    if (!id || !title) continue;
    const level: AnnouncementLevel = o?.level === "warn" ? "warn" : "info";
    out.push({ id, title, body, level, date: o?.date ? String(o.date) : undefined });
  }
  return out;
}

/** 未读 = 没点过「知道了」的那些（保持文件里的顺序） */
export function pickUnread(items: readonly AnnouncementItem[], readIds: readonly string[]): AnnouncementItem[] {
  const read = new Set(readIds.map((id) => String(id)));
  return items.filter((it) => !read.has(it.id));
}

async function readCache(): Promise<CacheEntry | null> {
  try {
    const v = (await chrome.storage.local.get(CACHE_KEY)) as { [k: string]: CacheEntry | undefined };
    const entry = v[CACHE_KEY];
    return entry && Array.isArray(entry.items) ? entry : null;
  } catch {
    return null;
  }
}

async function readReadIds(): Promise<string[]> {
  try {
    const v = (await chrome.storage.local.get(READ_KEY)) as { [k: string]: string[] | undefined };
    return Array.isArray(v[READ_KEY]) ? v[READ_KEY]! : [];
  } catch {
    return [];
  }
}

async function fetchFromSources(): Promise<AnnouncementItem[] | null> {
  const items = parseAnnouncement(await fetchFirstJson(await effectiveFileUrls(REMOTE_PATH)));
  return items.length ? items : null;
}

/**
 * 读公告：缓存新鲜就不发请求；否则拉一次并更新缓存；全失败就退回旧缓存。
 * 返回 items（全部）与 unread（未读的，用于决定要不要提示）。
 */
export async function readAnnouncement(
  opts: { force?: boolean } = {},
): Promise<{ items: AnnouncementItem[]; unread: AnnouncementItem[] }> {
  const cache = await readCache();
  const fresh = !!cache && Date.now() - cache.ts < TTL_MS;
  let items = cache?.items ?? [];
  if (opts.force || !fresh) {
    const fetched = await fetchFromSources();
    if (fetched) {
      items = fetched;
      try {
        await chrome.storage.local.set({ [CACHE_KEY]: { ts: Date.now(), items } satisfies CacheEntry });
      } catch {
        /* 缓存写失败无所谓 */
      }
    }
  }
  return { items, unread: pickUnread(items, await readReadIds()) };
}

/** 点「知道了」：记下 id（同一条不再重复提示） */
export async function dismissAnnouncement(ids: readonly string[]): Promise<void> {
  const list = ids.map((id) => String(id)).filter(Boolean);
  if (!list.length) return;
  try {
    const read = new Set(await readReadIds());
    for (const id of list) read.add(id);
    await chrome.storage.local.set({ [READ_KEY]: [...read] });
  } catch {
    /* 忽略 */
  }
}
