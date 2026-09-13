/**
 * ③ 匹配推荐引擎（设计见 docs/design.md §4-③ / §3.3-§3.4）。
 *
 * 查询顺序（不可动摇）：
 * 1. 我有 → keep；
 * 2. 没有 → L3 实战映射（Substitution，仅 verified），替代者我有 → substituted；
 * 3. 无映射 → L2 泛化知识条件匹配（v1，v0 仅展示不自动套用）；
 * 4. 仍无解 → unresolved（LLM 推断 v1 接入）。
 *
 * 风险分级：关键位（isKey）的任何替换/缺失 → risk=high，note 提示回评论区验证。
 */

import type { Box, RecommendedSlot, Roster, Substitution } from "./types";

export function recommend(
  roster: Roster,
  substitutions: Substitution[],
  box: Box,
): RecommendedSlot[] {
  return roster.slots.map((slot) => {
    // 1. 我有 → 保留
    if (box.operators[slot.operator]) {
      return {
        original: slot,
        finalOperator: slot.operator,
        status: "keep",
        via: null,
        alternatives: [],
        risk: "low",
        evidenceUrl: "",
        note: "",
      } satisfies RecommendedSlot;
    }

    // 2. L3 实战映射：只信字典校验通过的，按热度排序；主推荐取其中第一个替代者在 box 的
    const sorted = substitutions
      .filter((s) => s.removed === slot.operator && s.verified)
      .sort((a, b) => b.likes - a.likes);
    const best = sorted.find((s) => !!box.operators[s.replacement]);
    if (best) {
      return {
        original: slot,
        finalOperator: best.replacement,
        status: "substituted",
        kind: best.kind,
        via: best,
        alternatives: sorted.filter((s) => s !== best),
        risk: slot.isKey ? "high" : "low",
        evidenceUrl: best.evidenceUrl ?? "",
        note: slot.isKey ? "关键位替换，建议回评论区验证" : "",
      } satisfies RecommendedSlot;
    }

    // 3/4. 无解（v0：L2 条件匹配与 LLM 推断未接入）——直接列出全部实战建议，用户自行取舍
    return {
      original: slot,
      finalOperator: null,
      status: "unresolved",
      via: null,
      alternatives: sorted,
      risk: slot.isKey ? "high" : "medium",
      evidenceUrl: "",
      note: slot.isKey ? "关键位缺失——建议翻评论区确认，慎抄" : "",
    } satisfies RecommendedSlot;
  });
}
