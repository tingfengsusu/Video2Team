/**
 * ① 阵容提取（设计见 docs/design.md §4-①）。
 *
 * 优先级：视频简介 / 置顶评论（UP主通常写明阵容，最可靠）
 *        > 可选本地服务的抽帧 OCR + DeepSeek 多模态兜底（v1+）。
 * 同时标记关键位（isKey），供风险分级用。
 */

import type { Roster } from "./types";
import type { VideoInfo } from "./bilibili";

/** 从单个攻略视频提取阵容（干员+技能+部署顺序+关键位标记） */
export async function extractRoster(video: VideoInfo): Promise<Roster> {
  throw new Error("not implemented: v0 先走简介/置顶评论路径");
}
