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
 * 412 = B站风控（常见于无 Cookie/高频），自动重试一次。
 */
async function getJson(url: string, retry = true): Promise<any> {
  const doFetch = () =>
    fetch(url, {
      credentials: "include",
      headers: { Referer: "https://www.bilibili.com/" },
    });
  let resp = await doFetch();
  if (resp.status === 412 && retry) {
    await new Promise((r) => setTimeout(r, 900));
    resp = await doFetch();
  }
  if (!resp.ok) {
    throw new Error(
      resp.status === 412
        ? "B站风控拦截（HTTP 412）：稍等几秒再点分析重试"
        : `B站请求失败 HTTP ${resp.status}`,
    );
  }
  const j = await resp.json();
  if (j.code !== 0) throw new Error(`B站 API 错误 ${j.code}: ${j.message}`);
  return j;
}

export async function getVideoInfo(bvid: string): Promise<VideoInfo> {
  const j = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
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
    const j = await getJson(
      `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=1&pn=${pn}&ps=20`,
    );
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
