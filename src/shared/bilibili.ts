/**
 * B站 API 封装（端点均于 2026-09 实测可用，见 docs/notes/recon.md）。
 *
 * - 视频信息（含分P列表）：GET /x/web-interface/view?bvid={BV}
 * - 评论（置顶在 top 字段）：GET /x/v2/reply?type=1&oid={aid}&sort=1  —— 无需 wbi 签名
 * - 弹幕 XML（带时间戳，每分P独立 cid）：GET https://comment.bilibili.com/{cid}.xml
 *
 * 请求从用户浏览器发出（background service worker + host_permissions），
 * 携带用户 B站登录态，低频访问风控友好。
 */

import { wbiSign } from "./wbi";

export interface VideoPage {
  page: number; // 分P序号（URL 的 ?p=）
  part: string; // 分P标题（攻略合集即关卡名，如「SR-EX-8突袭」）
  cid: number;
}

export interface VideoInfo {
  bvid: string;
  aid: number;
  cid: number; // P1 的 cid
  title: string;
  desc: string; // 简介（阵容提取的优先来源）
  publishDate: string;
  pages: VideoPage[];
}

/**
 * 带 B站登录态与 Referer 的请求（扩展有 host 权限可携带 Cookie）。
 * 412 = B站风控：先重试一次，仍失败自动升级 wbi 签名后重签重试
 * （2024+ 部分节点对无签名请求间歇/持续 412，见 docs/notes/recon.md）。
 */
/**
 * 页面代理优先：把 API 请求转发到任一打开的B站页面内执行（content script BILI_FETCH），
 * 请求特征与用户正常浏览完全一致（Origin/Cookie/buvid），根治 CDN 对扩展后台的 412 风控。
 * 无B站页面打开时回退 SW 直连（Cookie+Referer，412 时自动升级 wbi 签名）。
 */
async function pageProxyFetch(url: string): Promise<{ status: number; text: string } | null> {
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.bilibili.com/*" });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        const resp = (await chrome.tabs.sendMessage(tab.id, { type: "BILI_FETCH", url })) as
          | { ok: boolean; status: number; text: string }
          | undefined;
        if (resp) return { status: resp.status, text: resp.text };
      } catch {
        /* 该 tab 无 content script（未刷新），试下一个 */
      }
    }
  } catch {
    /* tabs.query 失败（权限/无窗口），走回退 */
  }
  return null;
}

function biliError(status: number): Error {
  return new Error(
    status === 412
      ? "B站风控拦截（HTTP 412）：请打开任意B站页面后重试（页面代理不可用），或稍等 1-2 分钟"
      : `B站请求失败 HTTP ${status}`,
  );
}

async function getJson(
  url: string,
  params?: Record<string, string | number>,
  opts2: { signed?: boolean } = {},
): Promise<any> {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) usp.append(k, String(v));
  const full = params ? `${url}?${usp.toString()}` : url;
  // wbi 接口（搜索/导航）必须带签名：代理与直连都用签名 URL，避免先发一次裸请求
  const signedUrl = opts2.signed && params ? `${url}?${await wbiSign(params)}` : null;

  // 1) 页面代理（首选）
  const proxied = await pageProxyFetch(signedUrl ?? full);
  if (proxied) {
    if (proxied.status !== 200) throw biliError(proxied.status);
    const j = JSON.parse(proxied.text);
    if (j.code !== 0) throw new Error(`B站 API 错误 ${j.code}: ${j.message}`);
    return j;
  }

  // 2) 回退：SW 直连（412 时升级 wbi 签名）
  const opts = { credentials: "include" as const, headers: { Referer: "https://www.bilibili.com/" } };
  const build = async (withWbi: boolean): Promise<Response> => {
    if (withWbi && signedUrl) return fetch(signedUrl, opts);
    if (withWbi && params) return fetch(`${url}?${await wbiSign(params)}`, opts);
    return fetch(full, opts);
  };

  let resp = await build(!!signedUrl);
  if (resp.status === 412) {
    await new Promise((r) => setTimeout(r, 900));
    resp = await build(!!signedUrl);
  }
  if (resp.status === 412 && params) {
    resp = await build(true); // 升级 wbi 签名
  }
  if (!resp.ok) throw biliError(resp.status);
  const j = await resp.json();
  if (j.code !== 0) throw new Error(`B站 API 错误 ${j.code}: ${j.message}`);
  return j;
}

/** 拆出裸接口地址与参数（供 getJson 做签名升级） */
function target(url: string): { base: string; params?: Record<string, string | number> } {
  const u = new URL(url);
  const params: Record<string, string | number> = {};
  u.searchParams.forEach((v, k) => (params[k] = v));
  return { base: `${u.origin}${u.pathname}`, params };
}

export async function getVideoInfo(bvid: string): Promise<VideoInfo> {
  const { base, params } = target(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  const j = await getJson(base, params);
  const d = j.data;
  return {
    bvid: d.bvid,
    aid: d.aid,
    cid: d.cid,
    title: d.title,
    desc: d.desc ?? "",
    publishDate: new Date((d.pubdate ?? 0) * 1000).toISOString().slice(0, 10),
    pages: (d.pages ?? []).map((p: any) => ({ page: p.page, part: p.part, cid: p.cid })),
  };
}

export interface CommentItem {
  text: string;
  likes: number;
  isPinned: boolean;
  rpid: number;
}

export async function fetchComments(aid: number, maxCount = 200): Promise<CommentItem[]> {
  const out: CommentItem[] = [];
  // ps 实测上限 20（传 49 报 "ps out of bounds"，见端到端验收 2026-09-13）
  for (let pn = 1; out.length < maxCount && pn <= 10; pn++) {
    const { base, params } = target(
      `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=1&pn=${pn}&ps=20`,
    );
    const j = await getJson(base, params);
    if (pn === 1) {
      // 置顶评论（UP主常在此写阵容/补充说明，优先级最高）
      const tops: any[] = j.data?.top?.replies ?? [];
      for (const r of tops) {
        out.push({ text: r.content?.message ?? "", likes: r.like ?? 0, isPinned: true, rpid: r.rpid });
      }
    }
    for (const r of j.data?.replies ?? []) {
      out.push({ text: r.content?.message ?? "", likes: r.like ?? 0, isPinned: false, rpid: r.rpid });
    }
    if (!j.data?.replies?.length) break;
  }
  return out.slice(0, maxCount);
}

/** 拉取弹幕（MV3 service worker 无 DOMParser，用正则解析 XML） */
export async function fetchDanmaku(cid: number): Promise<Array<{ time: number; text: string }>> {
  const url = `https://comment.bilibili.com/${cid}.xml`;
  let xml: string;
  const proxied = await pageProxyFetch(url);
  if (proxied) {
    if (proxied.status !== 200) throw biliError(proxied.status);
    xml = proxied.text;
  } else {
    const resp = await fetch(url, {
      credentials: "include",
      headers: { Referer: "https://www.bilibili.com/" },
    });
    if (!resp.ok) throw biliError(resp.status);
    xml = await resp.text();
  }
  const out: Array<{ time: number; text: string }> = [];
  const re = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  for (const m of xml.matchAll(re)) {
    out.push({ time: parseFloat(m[1]), text: m[2] });
  }
  return out;
}

/** 构造评论区溯源链接（推荐结果的 evidenceUrl） */
export function replyUrl(bvid: string, rpid: number): string {
  return `https://www.bilibili.com/video/${bvid}/#reply${rpid}`;
}

// ---------- 搜索（§3 B站三级挖掘 · 层级①） ----------

/** 去掉搜索结果的 `<em class="keyword">` 高亮标签，并还原 HTML 实体 */
export function stripHighlight(html: string): string {
  return String(html ?? "")
    .replace(/<\/?em[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export interface SearchVideoItem {
  bvid: string;
  aid: number;
  title: string; // 已去 <em> 高亮
  description: string;
  author: string;
  mid: number;
  play: number;
  pubdate: number;
}

/** 视频搜索（wbi 签名；search_type=video）。失败抛错，由调用方降级。 */
export async function searchVideos(
  keyword: string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<SearchVideoItem[]> {
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const pageSize = Math.min(50, Math.max(1, Math.trunc(opts.pageSize ?? 20)));
  const j = await getJson(
    "https://api.bilibili.com/x/web-interface/wbi/search/type",
    { search_type: "video", keyword, page, page_size: pageSize },
    { signed: true },
  );
  const result: any[] = Array.isArray(j.data?.result) ? j.data.result : [];
  return result
    .filter((r) => r?.bvid && r?.type === "video")
    .map((r) => ({
      bvid: String(r.bvid),
      aid: Number(r.aid) || 0,
      title: stripHighlight(String(r.title ?? "")),
      description: stripHighlight(String(r.description ?? r.desc ?? "")),
      author: String(r.author ?? ""),
      mid: Number(r.mid) || 0,
      play: Number(r.play) || 0,
      pubdate: Number(r.pubdate) || 0,
    }));
}

/** 批量拉取视频信息（层级②分P标题 / 层级③简介）；逐个失败静默跳过。 */
export async function fetchVideoInfos(
  bvids: string[],
): Promise<Map<string, VideoInfo>> {
  const out = new Map<string, VideoInfo>();
  for (const bvid of bvids) {
    try {
      out.set(bvid, await getVideoInfo(bvid));
    } catch {
      /* 单条失败不影响整体 */
    }
  }
  return out;
}
