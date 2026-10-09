/**
 * ③ 匹配推荐引擎（设计见 docs/design.md §4-③ / §3.3-§3.4 / §4.2）。
 *
 * 查询顺序（不可动摇）：
 * 1. 可用（拥有且未被派遣占用）→ keep；
 * 2. 需要替换（缺 or 被派遣锁定）→ L3 实战映射，优先未被派遣的替代者，
 *    其次已派遣者（带冲突提示）；
 * 3. 无解 → unresolved（LLM 推断 v1 接入）。
 *
 * 占用清单（矢量突破类活动）：派遣关锁定的干员在推图关不可用——
 * 即使你拥有，也按"需要替换"处理，并在 note 中说明锁在哪个关。
 * 风险分级：关键位（isKey）的任何替换 → risk=high。
 */

import type { Box, LockedOps, RecommendedSlot, Roster, Substitution } from "./types";

export function recommend(
  roster: Roster,
  substitutions: Substitution[],
  box: Box,
  lockedOps: LockedOps = {},
): RecommendedSlot[] {
  const owned = (n: string) => !!box.operators[n];
  const lockedFrom = (n: string) => (owned(n) && lockedOps[n] ? lockedOps[n] : undefined);
  const canUse = (n: string) => owned(n) && !lockedOps[n];

  return roster.slots.map((slot) => {
    const op = slot.operator;
    const opLockedFrom = lockedFrom(op);
    // 这位干员的实战替代建议（弹幕/评论挖出来的）。
    // 注意：**"你有、能用"的干员也要算**——一旦它被别的关占用，就需要现成的替代方案；
    // 以前 keep 分支把 alternatives 置空，导致"已有的干员"的建议在界面上看不到（用户实测反馈）。
    const sorted = substitutions
      .filter((s) => s.removed === op && s.verified)
      .sort((a, b) => b.likes - a.likes);

    // 1. 可用 → 保留
    if (canUse(op)) {
      return {
        original: slot,
        finalOperator: op,
        status: "keep",
        via: null,
        alternatives: sorted,
        risk: "low",
        evidenceUrl: "",
        note: "",
      } satisfies RecommendedSlot;
    }

    // 2. 需要替换：优先未被派遣的替代者，其次已派遣者（带冲突提示）
    const best = sorted.find((s) => canUse(s.replacement)) ?? sorted.find((s) => owned(s.replacement));
    if (best) {
      const repLockedFrom = lockedOps[best.replacement];
      const notes: string[] = [];
      if (opLockedFrom) notes.push(`原干员已用于派遣（${opLockedFrom}）`);
      if (repLockedFrom) notes.push(`替代者也已派遣（${repLockedFrom}），存在冲突`);
      if (slot.isKey) notes.push("关键位替换，建议回评论区验证");
      return {
        original: slot,
        finalOperator: best.replacement,
        status: "substituted",
        kind: best.kind,
        via: best,
        alternatives: sorted.filter((s) => s !== best),
        risk: slot.isKey || repLockedFrom ? "high" : "low",
        evidenceUrl: best.evidenceUrl ?? "",
        note: notes.join("；"),
        lockedFrom: opLockedFrom,
      } satisfies RecommendedSlot;
    }

    // 3. 无解
    const note = opLockedFrom
      ? `已用于派遣（${opLockedFrom}），推图关需替换，但暂无可用替代建议`
      : slot.isKey
        ? "关键位缺失——建议翻评论区确认，慎抄"
        : "";
    return {
      original: slot,
      finalOperator: null,
      status: "unresolved",
      via: null,
      alternatives: sorted,
      risk: slot.isKey ? "high" : "medium",
      evidenceUrl: "",
      note,
      lockedFrom: opLockedFrom,
    } satisfies RecommendedSlot;
  });
}
