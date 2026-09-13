/**
 * ③ 匹配推荐引擎（设计见 docs/design.md §4-③ / §3.3-§3.4）。
 *
 * 策略（查询顺序，不可动摇）：
 * 1. 我有 → keep；
 * 2. 没有 → L3 实战映射（Substitution），替代者我有 → substituted；
 * 3. 无映射 → L2 泛化知识条件匹配本关环境（v1，v0 仅展示不自动套用）；
 * 4. 仍无解 → LLM 结合关卡机制 + 属性上下文推断（v1）。
 * 属性相似度匹配：不做。
 *
 * 风险分级：关键位（isKey）的任何替换 → risk=high，
 * note 提示「建议回评论区验证」。
 */

import type { Box, RecommendedSlot, Roster, Substitution } from "./types";

export async function recommend(
  roster: Roster,
  substitutions: Substitution[],
  box: Box,
): Promise<RecommendedSlot[]> {
  throw new Error("not implemented: v0 仅实现 1/2 两步（keep + L3 映射命中）");
}
