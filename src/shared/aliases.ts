/**
 * 昵称/黑话对照表（纠错集）——数据源与积累机制（2026-09-16 补齐）。
 *
 * 三层加载（后加载者优先覆盖）：
 *  ① 打包内快照 data/aliases.json（离线兜底）
 *  ② 远程（jsDelivr→raw GitHub）：上游社区数据（猜猜乐插件，需反转格式）+ 本仓库的精选快照
 *  ③ 用户本地对照（aliases_user）——由「昵称纠错」确认流程写入，优先级最高
 *
 * 运行时积累：AI 提取出的称呼若过不了干员字典校验，自动记入 corrections_pending
 * （含出现次数与原文样例），在设置页确认后并入本地对照。
 */

import ALIASES from "../../data/aliases.json";

const USER_KEY = "aliases_user"; // 本地对照：nickname -> 全名
const PENDING_KEY = "corrections_pending"; // 待确认：nickname -> {count, first, last, sample}
const CACHE_KEY = "aliases_remote"; // 远程合并结果缓存
const CACHE_TTL = 24 * 3600 * 1000;
const MAX_PENDING = 100;

export interface PendingEntry {
  name: string;
  count: number;
  first: number;
  last: number;
  sample: string;
}

let merged: Record<string, string> = { ...(ALIASES.aliases as Record<string, string>) };
let loaded = false;

/** 上游「猜猜乐」数据为 {干员名: [昵称...]}，反转成 {昵称: 干员名}；歧义昵称跳过 */
function invertUpstream(data: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!data || typeof data !== "object") return out;
  for (const [name, nicks] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(nicks)) continue;
    for (const n of nicks) {
      const k = String(n).trim();
      if (!k) continue;
      if (out[k] && out[k] !== name) continue; // 一个昵称指向多个干员 → 跳过
      out[k] = name;
    }
  }
  return out;
}

async function tryFetchJson(url: string): Promise<unknown | null> {
  try {
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/** 加载并合并三层别名（幂等；分析前调用一次即可，失败静默降级为已有层） */
export async function loadAliases(): Promise<void> {
  if (loaded) return;

  let remote: Record<string, string> = {};
  // ① 远程缓存
  try {
    const stored = (await chrome.storage.local.get(CACHE_KEY)) as Record<
      string,
      { ts: number; data: Record<string, string> } | undefined
    >;
    const c = stored[CACHE_KEY];
    if (c && Date.now() - c.ts < CACHE_TTL && c.data && Object.keys(c.data).length > 50) {
      remote = c.data;
    }
  } catch {
    /* 存储不可用则走网络 */
  }

  // ② 远程拉取（缓存过期时）
  if (Object.keys(remote).length === 0) {
    const upstream =
      (await tryFetchJson(
        "https://cdn.jsdelivr.net/gh/Li-shi-ling/astrbot_plugin_mrfzccl@master/arknights_operator_aliases.json",
      )) ??
      (await tryFetchJson(
        "https://raw.githubusercontent.com/Li-shi-ling/astrbot_plugin_mrfzccl/master/arknights_operator_aliases.json",
      ));
    if (upstream) Object.assign(remote, invertUpstream(upstream));

    const ours =
      (await tryFetchJson(
        "https://cdn.jsdelivr.net/gh/tingfengsusu/Video2Team@main/data/aliases.json",
      )) ??
      (await tryFetchJson(
        "https://raw.githubusercontent.com/tingfengsusu/Video2Team/main/data/aliases.json",
      ));
    if (ours && typeof ours === "object" && (ours as { aliases?: unknown }).aliases) {
      Object.assign(remote, (ours as { aliases: Record<string, string> }).aliases);
    }

    if (Object.keys(remote).length > 50) {
      void chrome.storage.local.set({ [CACHE_KEY]: { ts: Date.now(), data: remote } }).catch?.(() => {});
    }
  }

  // ③ 用户本地对照（最高优先级）
  let user: Record<string, string> = {};
  try {
    const stored = (await chrome.storage.local.get(USER_KEY)) as Record<string, Record<string, string> | undefined>;
    user = stored[USER_KEY] ?? {};
  } catch {
    /* 忽略 */
  }

  merged = { ...(ALIASES.aliases as Record<string, string>), ...remote, ...user };
  loaded = true;
}

/** 别名 → 干员全名（未命中返回原名） */
export function resolveAlias(name: string): string {
  const trimmed = name.trim();
  return merged[trimmed] ?? trimmed;
}

/** 合并后的完整对照表（注入 LLM 提示词用） */
export function aliasesForPrompt(): Record<string, string> {
  return merged;
}

// ---------- 运行时积累（待确认队列） ----------

function looksLikeName(n: string): boolean {
  const t = n.trim();
  return t.length >= 1 && t.length <= 14 && !/[\s\r\n]/.test(t);
}

/** 记录一个字典无法识别的称呼（分析过程中自动调用，失败静默） */
export async function recordUnknownName(name: string, sample = ""): Promise<void> {
  const n = name.trim();
  if (!looksLikeName(n)) return;
  if (merged[n]) return; // 已被别名表覆盖（不该走到这，防御）
  try {
    const stored = (await chrome.storage.local.get(PENDING_KEY)) as Record<
      string,
      Record<string, PendingEntry> | undefined
    >;
    const pending = stored[PENDING_KEY] ?? {};
    const now = Date.now();
    if (pending[n]) {
      pending[n].count += 1;
      pending[n].last = now;
      if (!pending[n].sample && sample) pending[n].sample = sample.slice(0, 80);
    } else {
      const keys = Object.keys(pending);
      if (keys.length >= MAX_PENDING) {
        // 超上限：淘汰最久未出现的
        keys.sort((a, b) => pending[a]!.last - pending[b]!.last);
        delete pending[keys[0]!];
      }
      pending[n] = { name: n, count: 1, first: now, last: now, sample: sample.slice(0, 80) };
    }
    await chrome.storage.local.set({ [PENDING_KEY]: pending });
  } catch {
    /* 积累失败不影响主流程 */
  }
}

export async function getPending(): Promise<PendingEntry[]> {
  try {
    const stored = (await chrome.storage.local.get(PENDING_KEY)) as Record<
      string,
      Record<string, PendingEntry> | undefined
    >;
    const pending = stored[PENDING_KEY] ?? {};
    return Object.values(pending).sort((a, b) => b.count - a.count || b.last - a.last);
  } catch {
    return [];
  }
}

/** 采纳：写入本地对照（最高优先级）并移出待确认队列 */
export async function approvePending(name: string, fullName: string): Promise<void> {
  const full = fullName.trim();
  if (!full) return;
  const stored = (await chrome.storage.local.get([USER_KEY, PENDING_KEY])) as Record<string, unknown>;
  const user = (stored[USER_KEY] as Record<string, string> | undefined) ?? {};
  user[name] = full;
  const pending = (stored[PENDING_KEY] as Record<string, PendingEntry> | undefined) ?? {};
  delete pending[name];
  await chrome.storage.local.set({ [USER_KEY]: user, [PENDING_KEY]: pending });
  merged[name] = full; // 当前会话内立即生效
}

/** 忽略：从待确认队列移除（不建立对照） */
export async function dismissPending(name: string): Promise<void> {
  const stored = (await chrome.storage.local.get(PENDING_KEY)) as Record<
    string,
    Record<string, PendingEntry> | undefined
  >;
  const pending = stored[PENDING_KEY] ?? {};
  delete pending[name];
  await chrome.storage.local.set({ [PENDING_KEY]: pending });
}

/** 本地对照条目数（设置页展示） */
export async function userAliasCount(): Promise<number> {
  try {
    const stored = (await chrome.storage.local.get(USER_KEY)) as Record<string, Record<string, string> | undefined>;
    return Object.keys(stored[USER_KEY] ?? {}).length;
  } catch {
    return 0;
  }
}
