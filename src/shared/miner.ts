/**
 * ②a 实战替代挖掘（L3）：从弹幕/评论区提取「XX 可以用 YY 代替」的映射对。
 *
 * 流程：抓取（bilibili.ts）→ 正则粗筛 → DeepSeek 精筛出「X→Y」映射对
 *      → 干员名字典校验（防幻觉）。
 * 评论区（尤其高赞）权重高于弹幕。分析单元是单个视频，
 * 弹幕/评论天然只讨论该视频对应的关卡，无需路由。
 */

import type { Roster, Substitution } from "./types";

/** 正则粗筛：命中「X可以换Y」「X用Y替」「没有X用Y」等句式的候选 */
export function prefilterCandidates(texts: string[]): string[] {
  throw new Error("not implemented");
}

/** DeepSeek 精筛 + 结构化提取，输出映射对并过字典校验 */
export async function mineSubstitutions(
  roster: Roster,
  comments: Array<{ text: string; likes: number; isPinned: boolean }>,
  danmaku: Array<{ time: number; text: string }>,
): Promise<Substitution[]> {
  throw new Error("not implemented: v0 仅评论区，置顶+高赞优先");
}
