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
async function getJson(url: string, params?: Record<string, string | number>): Promise<any> {
  const opts = { credentials: "include" as const, headers: { Referer: "https://www.bilibili.com/" } };
  const build = async (withWbi: boolean): Promise<Response> => {
    if (withWbi && params) return fetch(`${url}?${await wbiSign(params)}`, opts);
    // 普通路径：参数平铺（回归修复——url 参数现在是裸地址）
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params ?? {})) usp.append(k, String(v));
    return fetch(params ? `${url}?${usp.toString()}` : url, opts);
  };

  let resp = await build(false);
  if (resp.status === 412) {
    await new Promise((r) => setTimeout(r, 900));
    resp = await build(false);
  }
  if (resp.status === 412 && params) {
    resp = await build(true); // 升级 wbi 签名
  }
  if (!resp.ok) {
    throw new Error(
      resp.status === 412
        ? "B站风控拦截（HTTP 412，含 wbi 签名仍被拒）：可能触发高频限制，等待 1-2 分钟再试"
        : `B站请求失败 HTTP ${resp.status}`,
    );
  }
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

/** 拉取弹幕（MV3 service worker 无 DOMParser，用正则解析 XML；v1 挖掘用，此处先备好） */
export async function fetchDanmaku(cid: number): Promise<Array<{ time: number; text: string }>> {
  const doFetch = () =>
    fetch(`https://comment.bilibili.com/${cid}.xml`, {
      credentials: "include",
      headers: { Referer: "https://www.bilibili.com/" },
    });
  let resp = await doFetch();
  if (resp.status === 412) {
    await new Promise((r) => setTimeout(r, 900));
    resp = await doFetch();
  }
  if (!resp.ok) {
    throw new Error(
      resp.status === 412
        ? "B站风控拦截（HTTP 412）：稍等几秒再点分析重试"
        : `弹幕请求失败 HTTP ${resp.status}`,
    );
  }
  const xml = await resp.text();
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
