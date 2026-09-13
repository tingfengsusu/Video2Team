/**
 * B站 API 封装（侦察验证后补充具体字段解析，见 docs/notes/bilibili-api.md）。
 *
 * 已知端点（待验证）：
 * - 视频信息（含简介）：GET https://api.bilibili.com/x/web-interface/view?bvid={BV}
 * - 评论（置顶在 top_replies）：GET https://api.bilibili.com/x/v2/reply?type=1&oid={aid}&sort=1
 * - 弹幕 XML（带时间戳）：GET https://comment.bilibili.com/{cid}.xml（cid 来自 view 接口）
 *
 * 请求从用户浏览器发出（background service worker + host_permissions），
 * 携带用户 B站登录态，低频访问风控友好。
 */

import type { Roster } from "./types";

export interface VideoInfo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  desc: string; // 简介（阵容提取的优先来源）
  publishDate: string;
}

/** 获取视频信息（简介为阵容提取的优先来源之一） */
export async function getVideoInfo(bvid: string): Promise<VideoInfo> {
  throw new Error("not implemented: GET /x/web-interface/view");
}

/** 拉取评论（置顶优先），返回 [{text, likes, isPinned, rpid}] */
export async function fetchComments(
  aid: number,
  maxCount = 200,
): Promise<Array<{ text: string; likes: number; isPinned: boolean; rpid: number }>> {
  throw new Error("not implemented: GET /x/v2/reply");
}

/** 拉取弹幕 XML（带时间戳），返回 [{time, text}] */
export async function fetchDanmaku(
  cid: number,
): Promise<Array<{ time: number; text: string }>> {
  throw new Error("not implemented: GET comment.bilibili.com/{cid}.xml");
}

/** 构造评论区溯源链接（推荐结果的 evidenceUrl） */
export function replyUrl(bvid: string, rpid: number): string {
  return `https://www.bilibili.com/video/${bvid}/#reply${rpid}`;
}
