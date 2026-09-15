/**
 * ②a 实战替代挖掘（L3）：从弹幕/评论区提取「XX 可以用 YY 代替」的映射对。
 *
 * 流程：抓取（bilibili.ts）→ 正则粗筛 → DeepSeek 精筛出「X→Y」映射对
 *      → 干员名字典校验（防幻觉）。
 * 弹幕与评论双源（2026-09-13 验收修订）：实测弹幕中替代建议密度高于评论
 * （「老玛可以替askl」「大姨可以换杰哥」）；弹幕量大且无点赞信号 → 仅正则命中的
 * 弹幕进入候选；评论沿用 置顶/正则命中/高赞兜底。
 * 黑话缩写三层防线：aliases 注入 prompt → LLM 还原全名 → 字典校验拦截。
 * downkyi 等下载器的 .ass 弹幕文件同源（均为 comment.bilibili.com/{cid}.xml），
 * 本插件直接拉取 XML，无需中转。
 */

import { callDeepSeek, parseJsonLoose } from "./deepseek";
import { replyUrl, type CommentItem } from "./bilibili";
import type { OperatorDB } from "./operatorDB";
import type { Roster, Substitution } from "./types";
import ALIASES from "../../data/aliases.json";

/** 正则粗筛：命中替代语义关键词的候选（宽松，宁可多送 LLM） */
const SUB_HINTS = [
  /代替/, /替换/, /替代/, /平替/, /下位/, /换成/, /可换/, /能换/, /换上/,
  /可以替/, /可以换/, /没有.{0,10}用.{1,16}/, /用.{1,16}替/, /缺.{0,6}用/,
];

interface Candidate {
  i: number; // 候选编号（喂给 LLM，输出回填用）
  text: string;
  likes: number;
  isPinned: boolean;
  source: "danmaku" | "comment" | "pinned";
  rpid?: number; // 评论专属：溯源链接
  time?: number; // 弹幕专属：视频时间点(秒)
}

interface MinedItem {
  removed?: string;
  replacement?: string;
  kind?: string;
  evidence?: string;
  commentIndex?: number;
}

const KINDS = ["operator_swap", "skill_swap", "position_swap", "manual"];

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** 异格归一：弹幕说的干员名在阵容中无精确匹配时，尝试异格/升变版本（星熊→斩业星熊，纯烬艾雅法拉同理） */
function normalizeToRoster(removed: string, rosterNames: string[]): string | null {
  if (rosterNames.includes(removed)) return removed;
  const match = rosterNames.find((n) => n.includes(removed));
  return match ?? null;
}

export async function mineSubstitutions(
  roster: Roster,
  comments: CommentItem[],
  danmaku: Array<{ time: number; text: string }>,
  opDB: OperatorDB,
): Promise<Substitution[]> {
  const candidates: Candidate[] = [];
  const push = (c: Omit<Candidate, "i">) => candidates.push({ i: candidates.length, ...c });

  // 评论候选：置顶 ∪ 正则命中 ∪ 高赞前20
  const commentFlags = comments.map((c) => SUB_HINTS.some((re) => re.test(c.text)));
  comments.forEach((c) => {
    const idx = comments.indexOf(c);
    if (c.isPinned || commentFlags[idx]) {
      push({
        text: c.text, likes: c.likes, isPinned: c.isPinned,
        source: c.isPinned ? "pinned" : "comment", rpid: c.rpid,
      });
    }
  });
  const pickedTexts = new Set(candidates.map((c) => c.text));
  [...comments]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 20)
    .forEach((c) => {
      if (!pickedTexts.has(c.text)) {
        push({ text: c.text, likes: c.likes, isPinned: false, source: "comment", rpid: c.rpid });
      }
    });

  // 弹幕候选：仅正则命中（量大且无点赞信号，全部送 LLM 太贵）
  danmaku.forEach((d) => {
    if (d.text && SUB_HINTS.some((re) => re.test(d.text))) {
      push({
        text: `[弹幕 ${fmtTime(d.time)}] ${d.text}`,
        likes: 0, isPinned: false, source: "danmaku", time: d.time,
      });
    }
  });

  if (candidates.length === 0) return [];

  // 压缩 LLM 输入：候选上限 80（置顶/高赞优先），单条截断 150 字
  if (candidates.length > 80) {
    candidates.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.likes - a.likes);
    candidates.length = 80;
    candidates.forEach((c, i) => (c.i = i));
  }
  candidates.forEach((c) => {
    if (c.text.length > 150) c.text = c.text.slice(0, 150) + "…";
  });

  const rosterNames = roster.slots.map((s) => s.operator);
  const raw = await callDeepSeek([
    { role: "system", content: "你是明日方舟攻略数据提取引擎，只输出 JSON。" },
    {
      role: "user",
      content: [
        `任务：从B站弹幕/评论中提取「干员替代建议」——观众认为视频阵容中的干员X可以用干员Y代替。`,
        ``,
        `关卡 ${roster.stage} 的视频阵容（被替代者只能从中选）：`,
        rosterNames.map((n) => `- ${n}`).join("\n"),
        ``,
        `昵称/黑话对照表（弹幕评论中的昵称/简称请还原为干员全名）：`,
        JSON.stringify(ALIASES.aliases),
        ``,
        `弹幕/评论列表（编号|来源|点赞|内容）：`,
        candidates.map((c) => `${c.i} | ${c.source} | ${c.likes} | ${c.text}`).join("\n"),
        ``,
        `规则：`,
        `- removed：用阵容中的干员全名；弹幕提到的干员若在阵容中只有异格/升变版本（如「星熊」→阵容里的「斩业星熊」），视为同一干员，用阵容中的名字`,
        `- replacement：替代干员全名（昵称/简称先还原）`,
        `- kind：operator_swap(默认)/skill_swap(换技能或攻速)/position_swap(换部署位置)/manual(改手动)`,
        `- 弹幕口语极简（如「老玛可以替askl」），结合阵容与对照表谨慎判断；不确定就忽略`,
        `- 只提取替代建议；求助、吐槽、讨论练度等一律忽略；evidence 摘录原文`,
        ``,
        `仅输出 JSON 数组：[{"removed":"","replacement":"","kind":"","evidence":"","commentIndex":编号}]，无建议输出 []`,
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
    const removedRaw = opDB.resolve(it.removed ?? "");
    const removed = normalizeToRoster(removedRaw, rosterNames);
    const replacement = opDB.resolve(it.replacement ?? "");
    // removed 归一到阵容（含异格启发式）；replacement 必须是真实干员（字典校验，防幻觉/还原错误）
    if (!removed) continue;
    if (!replacement || !opDB.exists(replacement)) continue;
    if (removed === replacement) continue;
    const cand = it.commentIndex != null ? candidates.find((c) => c.i === it.commentIndex) : undefined;
    out.push({
      removed,
      replacement,
      stage: roster.stage,
      evidence: (it.evidence ?? cand?.text ?? "").slice(0, 200),
      source: cand?.source ?? "comment",
      kind: KINDS.includes(it.kind ?? "") ? (it.kind as Substitution["kind"]) : "operator_swap",
      likes: cand?.likes ?? 0,
      verified: true,
      evidenceUrl: cand?.rpid ? replyUrl(roster.videoId, cand.rpid) : undefined,
    });
  }

  // 同一对 (removed→replacement) 去重：评论（有赞/可溯源）优先于弹幕，同源取热度最高
  const best = new Map<string, Substitution>();
  const score = (s: Substitution) => (s.source !== "danmaku" ? 1e9 : 0) + s.likes;
  for (const s of out) {
    const k = `${s.removed}→${s.replacement}`;
    const prev = best.get(k);
    if (!prev || score(s) > score(prev)) best.set(k, s);
  }
  return [...best.values()].sort((a, b) => b.likes - a.likes);
}
