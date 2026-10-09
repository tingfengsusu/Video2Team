/**
 * 从仓库读一个小 JSON（公告 / 版本号用）：**多源并行 + 单源超时**，谁先通用谁。
 *
 * 为什么并行 + 超时：实测 raw.githubusercontent.com 在这边可能 20 秒才超时（被墙/代理问题），
 * 串行的话界面要干等；jsdelivr 通常更快，但它对 gh 文件有缓存延迟。两个一起发，
 * 谁先返回就用谁 —— 快且不牺牲新鲜度。
 */
const DEFAULT_TIMEOUT_MS = 4000;

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { cache: "no-cache", signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** 依次/并行尝试多个源；全部失败返回 null（调用方自行静默降级） */
export async function fetchFirstJson(
  urls: readonly string[],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown | null> {
  const list = urls.filter(Boolean);
  if (!list.length) return null;
  try {
    return await Promise.any(list.map((u) => fetchJson(u, timeoutMs)));
  } catch {
    return null;
  }
}

/** 远端仓库文件的候选地址（raw 官方 + jsdelivr CDN） */
export function repoFileUrls(path: string, repo = "tingfengsusu/Video2Team", branch = "main"): string[] {
  const p = String(path ?? "").replace(/^\/+/, "");
  return [
    `https://cdn.jsdelivr.net/gh/${repo}@${branch}/${p}`,
    `https://raw.githubusercontent.com/${repo}/${branch}/${p}`,
  ];
}
