/**
 * ②a 实战替代挖掘（L3）：从弹幕/评论区提取「XX 可以用 YY 代替」的映射对。
 *
 * 流程：抓取（bilibili.ts）→ 正则粗筛（+置顶/高赞兜底）→ DeepSeek 精筛出「X→Y」映射对
 *      → 干员名字典校验（防幻觉）。
 * 评论区（尤其高赞）权重高于弹幕。评论天然只讨论该关卡，无需路由（多分P评论路由见 roster）。
 * 黑话缩写三层防线：aliases 注入 prompt → LLM 还原全名 → 字典校验拦截。
 */

import { callDeepSeek, parseJsonLoose } from "./deepseek";
import { replyUrl, type CommentItem } from "./bilibili";
import type { OperatorDB } from "./operatorDB";
import type { Roster, Substitution } from "./types";
import ALIASES from "../../data/aliases.json";

/** 正则粗筛：命中替代语义关键词的候选（宽松，宁可多送 LLM） */
const SUB_HINTS = [
  /代替/, /替换/, /替代/, /平替/, /下位/, /换成/, /可换/, /能换/, /换上/,
  /没有.{0,10}用.{1,16}/, /用.{1,16}替/, /缺.{0,6}用/,
];

interface MinedItem {
  removed?: string;
  replacement?: string;
  kind?: string;
  evidence?: string;
  commentIndex?: number;
}

const KINDS = ["operator_swap", "skill_swap", "position_swap", "manual"];

export async function mineSubstitutions(
  roster: Roster,
  comments: CommentItem[],
  opDB: OperatorDB,
): Promise<Substitution[]> {
  // 候选集 = 置顶 ∪ 正则命中 ∪ 高赞前20（句式千变万化，粗筛可能漏）
  const flags = comments.map((c) => SUB_HINTS.some((re) => re.test(c.text)));
  const picked = new Set<number>();
  comments.forEach((c, i) => {
    if (c.isPinned || flags[i]) picked.add(i);
  });
  [...comments]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 20)
    .forEach((c) => picked.add(comments.indexOf(c)));
  const candidates = [...picked].map((i) => ({ i, ...comments[i]! }));
  if (candidates.length === 0) return [];

  const rosterNames = roster.slots.map((s) => s.operator);
  const raw = await callDeepSeek([
    { role: "system", content: "你是明日方舟攻略数据提取引擎，只输出 JSON。" },
    {
      role: "user",
      content: [
        `任务：从B站评论中提取「干员替代建议」——评论认为阵容中的干员X可以用干员Y代替。`,
        ``,
        `关卡 ${roster.stage} 的视频阵容（被替代者只能从中选）：`,
        rosterNames.map((n) => `- ${n}`).join("\n"),
        ``,
        `昵称/黑话对照表（评论中的昵称请还原为干员全名）：`,
        JSON.stringify(ALIASES.aliases),
        ``,
        `评论列表（编号|点赞|内容）：`,
        candidates.map((c) => `${c.i} | ${c.likes} | ${c.text}`).join("\n"),
        ``,
        `规则：`,
        `- removed：必须是上述阵容中的干员全名；replacement：替代干员全名（昵称先还原）`,
        `- kind：operator_swap(默认)/skill_swap(换技能或攻速)/position_swap(换部署位置)/manual(改手动)`,
        `- 只提取明确的替代建议；求助、吐槽、讨论练度等一律忽略`,
        `- evidence 摘录评论关键原文`,
        ``,
        `仅输出 JSON 数组：[{"removed":"","replacement":"","kind":"","evidence":"","commentIndex":评论编号}]，无建议输出 []`,
      ].join("\n"),
    },
  ]);

  let items: MinedItem[];
  try {
    items = parseJsonLoose<MinedItem[]>(raw);
  } catch {
    return [];
  }

  const out: Substitution[] = [];
  for (const it of items ?? []) {
    const removed = opDB.resolve(it.removed ?? "");
    const replacement = opDB.resolve(it.replacement ?? "");
    // removed 必须在阵容中；replacement 必须是真实干员（字典校验，防幻觉/还原错误）
    if (!rosterNames.includes(removed)) continue;
    if (!replacement || !opDB.exists(replacement)) continue;
    if (removed === replacement) continue;
    const comment = it.commentIndex != null ? candidates.find((c) => c.i === it.commentIndex) : undefined;
    out.push({
      removed,
      replacement,
      stage: roster.stage,
      evidence: (it.evidence ?? comment?.text ?? "").slice(0, 200),
      source: comment?.isPinned ? "pinned" : "comment",
      kind: KINDS.includes(it.kind ?? "") ? (it.kind as Substitution["kind"]) : "operator_swap",
      likes: comment?.likes ?? 0,
      verified: true,
      evidenceUrl: comment ? replyUrl(roster.videoId, comment.rpid) : undefined,
    });
  }

  // 同一对 (removed→replacement) 去重，保留热度最高
  const best = new Map<string, Substitution>();
  for (const s of out) {
    const k = `${s.removed}→${s.replacement}`;
    if (!best.has(k) || best.get(k)!.likes < s.likes) best.set(k, s);
  }
  return [...best.values()].sort((a, b) => b.likes - a.likes);
}
