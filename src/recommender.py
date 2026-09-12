"""③ 匹配推荐引擎（见 docs/design.md §4-③ / §3.3-§3.4）。

策略（可靠度排序，不可动摇）：
1. 我有 → keep；
2. 没有 → 查实战替代映射（Substitution），替代者我有 → substituted；
3. 映射无解 → LLM 结合关卡机制 + 干员属性上下文推断（v1）；
4. 属性相似度匹配：不做。

风险分级：关键位（is_key）的任何替换 → risk=high，note 提示「建议回评论区验证」。
"""

from src.models import Box, RecommendedSlot, Roster, Substitution


def recommend(
    roster: Roster,
    substitutions: list[Substitution],
    box: Box,
    operator_db=None,   # v1 传入，用于 LLM 推断时的属性上下文
) -> list[RecommendedSlot]:
    raise NotImplementedError("v0: 仅实现 1/2 两步（keep + 映射命中）")
