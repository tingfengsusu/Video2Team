/**
 * ②a 实战替代挖掘（L3）：从弹幕/评论区提取「XX 可以用 YY 代替」的映射对。
 *
 * 流程：抓取（bilibili.ts）→ 正则粗筛（+置顶/高赞兜底）→ AI 精筛出「X→Y」映射对
 *      → 干员名字典校验（防幻觉）。
 * 弹幕与评论双源（2026-09-13 验收修订）：实测弹幕中替代建议密度高于评论
 * （「老玛可以替askl」「大姨可以换杰哥」）；弹幕量大且无点赞信号 → 仅正则命中的
 * 弹幕进入候选；评论沿用 置顶/正则命中/高赞兜底。
 * 黑话缩写三层防线：aliases 注入 prompt → AI 还原全名 → 字典校验拦截。
 * 本模块拆分为 buildCandidates / prepareMining（API）/ buildWebCombinedMessages（网页版合并）
 * / parseMiningReply 四段，供两种调用模式复用。
 */

import { callLLM, parseJsonLoose, type AskFn, type ChatMessage } from "./llm";
import { replyUrl, type CommentItem } from "./bilibili";
import type { OperatorDB } from "./operatorDB";
import type { Roster, Substitution } from "./types";
import { aliasesForPrompt, recordUnknownName } from "./aliases";

/** 正则粗筛：命中替代语义关键词的候选（宽松，宁可多送 AI） */
const SUB_HINTS = [
  /代替/, /替换/, /替代/, /平替/, /下位/, /换成/, /可换/, /能换/, /换上/,
  /可以替/, /可以换/, /没有.{0,10}用.{1,16}/, /用.{1,16}替/, /缺.{0,6}用/,
];

export interface Candidate {
  i: number; // 候选编号（喂给 AI，输出回填用）
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

export interface MiningPrepared {
  messages: ChatMessage[];
  candidates: Candidate[];
}

export interface CandidateCaps {
  comments?: number; // 评论候选上限（默认 60，设置页可配）
  danmaku?: number; // 弹幕候选上限（默认 60，设置页可配）
}

/** 候选集构建：评论（置顶∪正则命中∪高赞前20）与弹幕（仅正则命中）分开配额，互不挤占 */
export function buildCandidates(
  comments: CommentItem[],
  danmaku: Array<{ time: number; text: string }>,
  caps: CandidateCaps = {},
): Candidate[] {
  const commentCap = caps.comments ?? 60;
  const danmakuCap = caps.danmaku ?? 60;
  // —— 评论候选 ——
  const commentCands: Candidate[] = [];
  const commentFlags = comments.map((c) => SUB_HINTS.some((re) => re.test(c.text)));
  comments.forEach((c) => {
    const idx = comments.indexOf(c);
    if (c.isPinned || commentFlags[idx]) {
      commentCands.push({
        i: 0, text: c.text, likes: c.likes, isPinned: c.isPinned,
        source: c.isPinned ? "pinned" : "comment", rpid: c.rpid,
      });
    }
  });
  const pickedTexts = new Set(commentCands.map((c) => c.text));
  [...comments]
    .sort((a, b) => b.likes - a.likes)
    .slice(0, 20)
    .forEach((c) => {
      if (!pickedTexts.has(c.text)) {
        commentCands.push({ i: 0, text: c.text, likes: c.likes, isPinned: false, source: "comment", rpid: c.rpid });
      }
    });
  if (commentCands.length > commentCap) {
    commentCands.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.likes - a.likes);
    commentCands.length = commentCap;
  }

  // —— 弹幕候选（仅正则命中；独立配额 60，不因评论多而被截掉） ——
  const danmakuCands: Candidate[] = [];
  danmaku.forEach((d) => {
    if (d.text && SUB_HINTS.some((re) => re.test(d.text))) {
      danmakuCands.push({
        i: 0, text: `[弹幕 ${fmtTime(d.time)}] ${d.text}`,
        likes: 0, isPinned: false, source: "danmaku", time: d.time,
      });
    }
  });
  if (danmakuCands.length > danmakuCap) danmakuCands.length = danmakuCap;

  const candidates = [...commentCands, ...danmakuCands];
  candidates.forEach((c, idx) => {
    c.i = idx;
    if (c.text.length > 150) c.text = c.text.slice(0, 150) + "…";
  });
  return candidates;
}

/** 挖掘任务的提示词正文（rosterNames 为 null 时引用前文阵容；combined 控制输出格式说明归属；
 *  includeAliases=false 用于合并提示词——第一步正文已带对照表，避免重复占用 token） */
function buildMiningPromptText(
  stage: string,
  rosterNames: string[] | null,
  candidates: Candidate[],
  combined: boolean,
  includeAliases = true,
): string {
  const refPrev = rosterNames === null;
  const rosterSection = refPrev
    ? `关卡 ${stage} 的视频阵容：你在上文识别出的干员（被替代者必须是那些干员）。`
    : `关卡 ${stage} 的视频阵容（被替代者只能从中选）：\n${(rosterNames ?? []).map((n) => `- ${n}`).join("\n")}`;
  const outputLine = combined
    ? `（最终输出格式见文末统一说明）`
    : `\n仅输出 JSON 数组：[{"removed":"","replacement":"","kind":"","evidence":"","commentIndex":编号}]，无建议输出 []`;
  return [
    `任务：从B站弹幕/评论中提取「干员替代建议」——观众认为视频阵容中的干员X可以用干员Y代替。`,
    ``,
    rosterSection,
    ``,
    ...(includeAliases
      ? [`昵称/黑话对照表（弹幕评论中的昵称/简称请还原为干员全名）：`, JSON.stringify(aliasesForPrompt()), ``]
      : []),
    `弹幕/评论列表（编号|来源|点赞|内容）：`,
    candidates.map((c) => `${c.i} | ${c.source} | ${c.likes} | ${c.text}`).join("\n"),
    ``,
    `规则：`,
    `- removed：用阵容中的干员全名；弹幕提到的干员若在阵容中只有异格/升变版本（如「星熊」→阵容里的「斩业星熊」），视为同一干员，用阵容中的名字`,
    `- replacement：替代干员全名（昵称/简称先还原）；练度修饰词不属于名字，剥离后再还原（「高练机械师」→「机械师」）`,
    `- kind：operator_swap(默认)/skill_swap(换技能或攻速)/position_swap(换部署位置)/manual(改手动)`,
    `- 弹幕口语极简（如「老玛可以替askl」），结合阵容与对照表谨慎判断；不确定就忽略`,
    `- 只提取替代建议；求助、吐槽、讨论练度等一律忽略；evidence 摘录原文`,
    outputLine,
  ].join("\n");
}

/** API 模式：挖掘提示词（阵容显式列出，输出纯数组） */
export function prepareMining(
  stage: string,
  rosterNames: string[] | null,
  comments: CommentItem[],
  danmaku: Array<{ time: number; text: string }>,
  caps: CandidateCaps = {},
): MiningPrepared {
  const candidates = buildCandidates(comments, danmaku, caps);
  const messages: ChatMessage[] = [
    { role: "system", content: "你是明日方舟攻略数据提取引擎，只输出 JSON。" },
    { role: "user", content: buildMiningPromptText(stage, rosterNames, candidates, false) },
  ];
  return { messages, candidates };
}

/**
 * 网页版模式：单段合并提示词（第一步识别阵容 + 第二步挖掘建议 → 只输出一个 JSON），
 * 一次发送、一次回贴即可拿到全量数据，避免聊天里出现两段 JSON。
 */
export function buildWebCombinedMessages(
  stage: string,
  rosterPromptText: string,
  comments: CommentItem[],
  danmaku: Array<{ time: number; text: string }>,
  imageDataUrls: string[],
  caps: CandidateCaps = {},
): MiningPrepared {
  const candidates = buildCandidates(comments, danmaku, caps);
  const outputSchema =
    `【最终输出】仅输出一个 JSON：\n` +
    `{"stageResolution":{"explicitCode":"","matchedName":"","gridRows":0,"gridColumnsTotal":0,"enabledSupplies":0,"gridPosition":0,"gridRow":0,"gridColumn":0,"gridColumns":0,"gridName":"","gridCells":[{"position":0,"row":0,"column":0,"columns":0,"name":""}],"note":""},"roster":{"operators":[{"name":"","support":false,"isKey":false,"keyReason":""}]},"substitutions":[{"removed":"","replacement":"","kind":"","evidence":"","commentIndex":编号}]}\n` +
    `- stageResolution：只在截图/文字里有关卡识别证据时填写，没有证据时保留空串/0\n` +
    `  · explicitCode：**当前关画面里明确写出**的显示码（VEC-C 或 VEC-SPxx）；画面里没写就留空，不要用视频标题或别的截图里的号，也不要按数字猜\n` +
    `  · matchedName：当前关读到的中文通名（只读关卡名文字；「特别战线」这类界面标题不是通名，不要填）\n` +
    `  · gridPosition：仅在网格里**只有一个已启用格**时填写，按“从上到下、从左到右”从 1 编号\n` +
    `  · 若更易判断，可填 gridRow/gridColumn/gridColumns，由插件换算；gridName 填该格中文通名供交叉校验\n` +
    `  · gridRows / gridColumnsTotal：**先数清完整网格有多少行、多少列**（含未选中的白格与灰色禁用格），把这两个数字填上，再按行列定位黄色格（这是识别错位的根源，务必先数格子）\n` +
    `  · enabledSupplies：画面「当前启用补给 N/M」里的 **N**（没有这个数字就填 0）\n` +
    `  · gridCells：**任意一张图**里出现特别战线/派遣选择网格（常见为补给/图标网格）时，逐格列出其中的**全部已启用格**（通常为黄色底格；配色看不出时以「当前启用补给 N」为准，你数到的启用格数量应与 N 对得上）；与"当前关"是哪一关无关，必须独立填写；白色未选格、灰色禁用格不算\n` +
    `  · **格位是必填项，格内文字是选填项**：每格至少给出 position，或 row + column（columns 可借用 gridColumnsTotal）。插件**只按格位序号**定位关卡——格内文字是补给/装备名，不在关卡库，只作交叉校验；**看不清文字完全不影响填格位**，name 留空即可。绝不能因为"文字没读清/没确认全名称"就不填这一格，更不能因此整组留空（这是实测最常见的失败原因）\n` +
    `  · gridCells.position 是按完整网格从上到下、从左到右的序号，不是“第几个黄色格”；行列也按完整网格计算，上方第一行/左侧第一列为 1，columns 填总列数\n` +
    `  · 行列计数要点：**白色/灰色/未解锁格同样占行号和列号**，从画面最上方一行、最左侧一列开始数，不要跳过任何行或列（实测常见错误：漏掉最上面一排未选中的白格，导致整串行号偏移）\n` +
    `  · 格内文字若**看得清**就照实填写（多半是补给/装备名，如「催化装备」），不要改写成关卡名、也不要凭位置猜关卡名；看不清就留空 name\n` +
    `  · gridRows / gridColumnsTotal 必须**填进这两个字段**（不要只写在 note 里）；例：4×4 网格里有 6 个高亮格 → gridRows=4、gridColumnsTotal=4、gridCells 恰好 6 条\n` +
    `  · 填完后自检：gridCells 的数量应等于 enabledSupplies（当它 >0 时）；不一致就重新数一遍行列再填。只有"确实分辨不出哪些格是高亮的"才允许 gridCells 为空，此时必须在 note 里写清你看到了什么，并保留 enabledSupplies / gridRows / gridColumnsTotal\n` +
    `  · 例：四列网格中第一行第二格 position=2，第二行第一格 position=5，第三行第四格 position=12；不要把黄色格重新排成 1、2、3…\n` +
    `  · **格内是图标、认不出名称时照样填格位**（实测最常见的失败）：例如 4×4 网格、高亮格是「第2行第1、2、3格」与「第3行第2、3、4格」共 6 格 → gridCells 直接写 [{"position":5},{"position":6},{"position":7},{"position":10},{"position":11},{"position":12}]（name 全部留空即可），gridRows=4、gridColumnsTotal=4。**不要把位置只写在 note 里**——位置本身就够定位关卡，名称只是交叉校验\n` +
    `  · 通名 OCR 只读**黄色格内部**的名称文字区域，不读格子外的界面标题/栏目名/按钮文案（「特别战线」「矢量突破」「选择关卡」「作战」等一律不算通名，宁可留空）\n` +
    `- roster.operators：第一步识别出的全部干员（含助战干员）；name 只取干员名本体，练度修饰词（高练/低练/满练/满配/专三/专二/专一/满潜/满级/精二/精一/模组/XX级 等）剥离后填写\n` +
    `- substitutions：第二步的替代建议；无建议时为空数组 []`;
  const text = [
    `任务：这是一次两步合并分析，请依次完成，最后只输出一个 JSON。`,
    imageDataUrls.length > 1
      ? `截图**没有固定顺序**：请按画面内容判断每张图是什么——① 特别战线/派遣选择网格（带黄色底格）② 编队/阵容画面（「开始行动」UI）③ 助战详情页；同一类可能有多张，也可能缺某一类。` +
        `两条证据必须分别识别，不能互相覆盖：网格里的黄色格列表与当前关阵容是两回事（不要让当前关的 VEC-C 之类覆盖黄色格，也不要反过来）。`
      : `若截图中出现特别战线网格，请同时识别当前关和全部黄色格，两者不能互相覆盖。`,
    ``,
    `【第一步：识别视频阵容】`,
    rosterPromptText,
    ``,
    `【第二步：挖掘替代建议】`,
    buildMiningPromptText(stage, null, candidates, true, false), // 对照表已在第一步正文中，勿重复
    ``,
    outputSchema,
  ].join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: "你是明日方舟攻略分析引擎，只输出 JSON。" },
    {
      role: "user",
      content: [
        { type: "text", text },
        ...imageDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ];
  return { messages, candidates };
}

/** 解析挖掘回复（数组或 {"substitutions":[...]} 合并格式）并做字典校验/去重 */
export function parseMiningReply(
  items: unknown[],
  rosterNames: string[],
  candidates: Candidate[],
  stage: string,
  videoId: string,
  opDB: OperatorDB,
  onUnknown?: (name: string, sample?: string) => void,
): Substitution[] {
  const out: Substitution[] = [];
  for (const raw of items ?? []) {
    const it = raw as MinedItem;
    const removedRaw = opDB.resolve(it?.removed ?? "");
    const removed = normalizeToRoster(removedRaw, rosterNames);
    const replacement = opDB.resolve(it?.replacement ?? "");
    // removed 归一到阵容（含异格启发式）；replacement 必须是真实干员（字典校验，防幻觉/还原错误）
    if (!removed) continue;
    if (!replacement || !opDB.exists(replacement)) {
      if (replacement) {
        void recordUnknownName(replacement, it?.evidence ?? ""); // 记入昵称纠错待确认
        onUnknown?.(replacement, it?.evidence ?? "");
      }
      continue;
    }
    if (removed === replacement) continue;
    const cand = it.commentIndex != null ? candidates.find((c) => c.i === it.commentIndex) : undefined;
    out.push({
      removed,
      replacement,
      stage,
      evidence: (it.evidence ?? cand?.text ?? "").slice(0, 200),
      source: cand?.source ?? "comment",
      kind: KINDS.includes(it.kind ?? "") ? (it.kind as Substitution["kind"]) : "operator_swap",
      likes: cand?.likes ?? 0,
      verified: true,
      evidenceUrl: cand?.rpid ? replyUrl(videoId, cand.rpid) : undefined,
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

/** API 模式主路径：准备 → 调用 → 解析 */
export async function mineSubstitutions(
  roster: Roster,
  comments: CommentItem[],
  danmaku: Array<{ time: number; text: string }>,
  opDB: OperatorDB,
  ask: AskFn = callLLM,
): Promise<Substitution[]> {
  const rosterNames = roster.slots.map((s) => s.operator);
  const { messages, candidates } = prepareMining(roster.stage, rosterNames, comments, danmaku);
  if (candidates.length === 0) return [];

  const raw = await ask(messages);
  let items: unknown[];
  try {
    const v = parseJsonLoose<unknown>(raw);
    items = Array.isArray(v) ? v : ((v as { substitutions?: unknown[] })?.substitutions ?? []);
  } catch {
    return [];
  }
  return parseMiningReply(items, rosterNames, candidates, roster.stage, roster.videoId, opDB);
}
