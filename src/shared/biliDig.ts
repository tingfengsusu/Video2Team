/**
 * §3 B站三级挖掘（补充数据源：实战视频与新打法）。
 *
 * 用于补充 MAA 源没有的视频实战内容（新干员单核、低配打法）。三级渐进：
 *   ① 搜索主标题   `x/web-interface/wbi/search/type?search_type=video&keyword=VEC-SP07`（wbi 签名）
 *   ② 命中合集的分P标题（view API 的 pages[].part，每合集 1 请求）
 *   ③ 简介补充（view API 的 desc，触发式：候选池 < 3 个干员时才拉）
 *
 * 三级语料合成后**一次 LLM 调用**提取 `{operators[], mode}`，
 * 结果再过干员名字典 + 纠错集校验（防幻觉）。LLM 不可用时退回确定性字典匹配。
 * 标题空心（没有任何干员名）的条目会被丢弃，不产生幻觉条目。
 */

import { fetchVideoInfos, searchVideos, stripHighlight, type SearchVideoItem } from "./bilibili";
import { aliasesForPrompt } from "./aliases";
import { callLLM, parseJsonLoose, type AskFn, type ChatMessage } from "./llm";

/** 干员名字典的最小接口（OperatorDB 结构化满足；自测可注入假字典） */
export interface NameDict {
  resolve(name: string): string;
  exists(name: string): boolean;
  names(): string[];
}

/** 挖掘出的一个实战方案（按关卡聚合前） */
export interface BiliScheme {
  bvid: string;
  url: string;
  title: string; // 来源标题 / 分P标题（已去 <em> 高亮）
  operators: string[]; // 字典校验后的标准全名
  mode: string; // 单人 / 双人 / 低星 / 挂机 …（可空）
  author: string;
  kind: CorpusKind; // 命中层级
}

type CorpusKind = "title" | "part" | "desc";

interface CorpusEntry {
  bvid: string;
  text: string;
  kind: CorpusKind;
  title: string;
}

export interface BiliMineStats {
  searched: number; // 搜索结果条数
  pagesSearched: number;
  partsFetched: number; // 层级②触发的合集数
  descsFetched: number; // 层级③触发的简介数
  llmUsed: boolean; // 是否走了 LLM 精筛（false = 字典兜底）
}

export interface BiliMineResult {
  schemes: BiliScheme[];
  stats: BiliMineStats;
  /** 搜索阶段完全失败（无网络 / 风控）时为 true → 调用方静默跳过 B站源 */
  failed: boolean;
}

export interface MineOptions {
  pages?: number; // 搜索页数（默认 2）
  maxPartsVideos?: number; // 层级②最多拉几个合集（默认 5）
  maxDescVideos?: number; // 层级③最多拉几个简介（默认 8）
  ask?: AskFn | null; // LLM 调用器；不传则只用字典兜底
}

// ---------- 模式标签 ----------

const MODE_PATTERNS: Array<[RegExp, string]> = [
  [/单人|单刷|一只?个?干员|仅一?名?干员/, "单人"],
  [/双人|两个干员|两名干员/, "双人"],
  [/三人|三个干员/, "三人"],
  [/低星|低配|低练/, "低星"],
  [/挂机|全自动|自动/, "挂机"],
  [/无核/, "无核"],
  [/单核/, "单核"],
  [/双核/, "双核"],
  [/速刷|速通|最快/, "速刷"],
  [/代理|剿灭/, "代理"],
];

export function detectMode(text: string): string {
  return MODE_PATTERNS.filter(([re]) => re.test(text))
    .map(([, label]) => label)
    .join("+");
}

// ---------- 确定性字典匹配（兜底；也用于判断是否需要 ②③） ----------

interface NameIndex {
  names: string[]; // 长名优先，避免「凯尔希」被「凯尔」抢先
}

function buildNameIndex(dict: NameDict): NameIndex {
  const aliases = Object.keys(aliasesForPrompt());
  const all = new Set<string>();
  for (const n of dict.names()) if (n.length >= 2 || /^[A-Za-z]$/.test(n)) all.add(n);
  for (const a of aliases) if (a.length >= 2) all.add(a);
  return { names: [...all].sort((a, b) => b.length - a.length) };
}

/** 文本中出现的干员（字典 + 纠错集 → 标准全名），按出现顺序去重 */
export function matchOperators(text: string, dict: NameDict, index: NameIndex = buildNameIndex(dict)): string[] {
  const found: Array<{ full: string; pos: number }> = [];
  const seen = new Set<string>();
  for (const name of index.names) {
    const pos = text.indexOf(name);
    if (pos < 0) continue;
    const full = dict.resolve(name);
    if (!dict.exists(full) || seen.has(full)) continue;
    seen.add(full);
    found.push({ full, pos });
  }
  // 按命中词在文本中的位置排序（别名命中时用别名位置，不能用全名再查一次）
  found.sort((a, b) => a.pos - b.pos);
  return found.map((f) => f.full);
}

// ---------- LLM 精筛（一次调用处理全部语料） ----------

const MAX_ENTRIES = 40;
const MAX_ENTRY_CHARS = 160;

export function buildExtractMessages(displayCode: string, entries: CorpusEntry[]): ChatMessage[] {
  const lines = entries
    .slice(0, MAX_ENTRIES)
    .map((e, i) => `${i} | ${e.kind} | ${e.text.slice(0, MAX_ENTRY_CHARS)}`)
    .join("\n");
  return [
    {
      role: "system",
      content: "你是明日方舟攻略标题解析引擎，只输出 JSON，不做推测。",
    },
    {
      role: "user",
      content: [
        `任务：下面是B站搜索「${displayCode}」得到的攻略标题 / 分P标题 / 简介片段。`,
        `请提取每条里**明确写出**的干员名单与打法模式。`,
        ``,
        `语料（行号 | 来源 | 文本）：`,
        lines,
        ``,
        `昵称/黑话对照表（先还原全名再输出）：`,
        JSON.stringify(aliasesForPrompt()),
        ``,
        `规则：`,
        `- operators 只填文本里**确凿出现**的干员全名；没有写干员名的条目直接跳过（不要输出该条）`,
        `- mode 从 单人/双人/三人/低星/挂机/无核/单核/双核/速刷 中选，没有就留空字符串`,
        `- 不要输出行号之外的任何解释`,
        ``,
        `仅输出 JSON：{"schemes":[{"index":0,"operators":["凯尔希"],"mode":"单人"}]}`,
      ].join("\n"),
    },
  ];
}

interface ExtractedScheme {
  index?: number;
  operators?: unknown;
  mode?: unknown;
}

/** 解析 LLM 回复：行号回填 bvid，干员名过字典校验（幻觉名被丢弃） */
export function parseExtractReply(raw: string, entries: CorpusEntry[], dict: NameDict): BiliScheme[] {
  let parsed: { schemes?: ExtractedScheme[] };
  try {
    parsed = parseJsonLoose<{ schemes?: ExtractedScheme[] }>(raw);
  } catch {
    return [];
  }
  const out: BiliScheme[] = [];
  const seen = new Set<string>();
  for (const s of Array.isArray(parsed.schemes) ? parsed.schemes : []) {
    const entry = entries[Number(s?.index)];
    if (!entry) continue;
    const ops: string[] = [];
    for (const raw of Array.isArray(s?.operators) ? s.operators : []) {
      const full = dict.resolve(String(raw));
      if (dict.exists(full) && !ops.includes(full)) ops.push(full);
    }
    if (!ops.length) continue; // 标题空心 → 不产生条目
    const key = `${entry.bvid}|${ops.join("+")}|${entry.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      bvid: entry.bvid,
      url: `https://www.bilibili.com/video/${entry.bvid}`,
      title: entry.title,
      operators: ops,
      mode: String(s?.mode ?? "").trim() || detectMode(entry.text),
      author: "",
      kind: entry.kind,
    });
  }
  return out;
}

/** 确定性兜底：直接对语料做字典匹配（LLM 不可用 / 失败时） */
export function extractByDictionary(entries: CorpusEntry[], dict: NameDict): BiliScheme[] {
  const index = buildNameIndex(dict);
  const out: BiliScheme[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const ops = matchOperators(entry.text, dict, index);
    if (!ops.length) continue;
    const key = `${entry.bvid}|${ops.join("+")}|${entry.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      bvid: entry.bvid,
      url: `https://www.bilibili.com/video/${entry.bvid}`,
      title: entry.title,
      operators: ops,
      mode: detectMode(entry.text),
      author: "",
      kind: entry.kind,
    });
  }
  return out;
}

// ---------- 三级挖掘主流程 ----------

function toEntries(items: SearchVideoItem[]): CorpusEntry[] {
  const out: CorpusEntry[] = [];
  for (const it of items) {
    const text = [it.title, it.description].filter(Boolean).join(" ｜ ");
    out.push({
      bvid: it.bvid,
      text: stripHighlight(text),
      kind: "title",
      title: stripHighlight(it.title),
    });
  }
  return out;
}

/**
 * 三级挖掘一个关卡的 B站实战方案。
 * 搜索失败 → `failed: true`（无网络/风控），调用方静默降级。
 */
export async function mineStage(
  displayCode: string,
  dict: NameDict,
  opts: MineOptions = {},
): Promise<BiliMineResult> {
  const pages = Math.max(1, Math.min(3, Math.trunc(opts.pages ?? 2)));
  const maxPartsVideos = Math.max(0, opts.maxPartsVideos ?? 5);
  const maxDescVideos = Math.max(0, opts.maxDescVideos ?? 8);
  const stats: BiliMineStats = {
    searched: 0,
    pagesSearched: 0,
    partsFetched: 0,
    descsFetched: 0,
    llmUsed: false,
  };

  const keyword = displayCode.trim();
  if (!keyword) return { schemes: [], stats, failed: true };

  // —— ① 主标题搜索 ——
  const items: SearchVideoItem[] = [];
  let searchOk = false;
  for (let page = 1; page <= pages; page += 1) {
    try {
      const got = await searchVideos(keyword, { page, pageSize: 20 });
      stats.pagesSearched += 1;
      searchOk = true;
      if (!got.length) break;
      items.push(...got);
    } catch {
      break; // 单页失败即停止翻页
    }
  }
  stats.searched = items.length;
  if (!searchOk && items.length === 0) return { schemes: [], stats, failed: true };

  const entries = toEntries(items);
  const authorOf = new Map(items.map((i) => [i.bvid, i.author]));
  const index = buildNameIndex(dict);
  const distinctCount = (): number => {
    const set = new Set<string>();
    for (const e of entries) for (const op of matchOperators(e.text, dict, index)) set.add(op);
    return set.size;
  };

  // —— ② 命中合集的分P标题（候选不足时才拉） ——
  if (distinctCount() < 3 && maxPartsVideos > 0 && items.length) {
    const targets = items.slice(0, maxPartsVideos).map((i) => i.bvid);
    const infos = await fetchVideoInfos(targets);
    for (const [bvid, info] of infos) {
      if (info.pages.length < 2) continue;
      stats.partsFetched += 1;
      for (const pg of info.pages) {
        const part = stripHighlight(pg.part);
        if (!part) continue;
        entries.push({ bvid, text: part, kind: "part", title: part });
      }
    }
  }

  // —— ③ 简介补充（仍不足时才拉） ——
  if (distinctCount() < 3 && maxDescVideos > 0 && items.length) {
    const targets = items.slice(0, maxDescVideos).map((i) => i.bvid);
    const infos = await fetchVideoInfos(targets);
    for (const [bvid, info] of infos) {
      const desc = stripHighlight(info.desc);
      if (!desc) continue;
      stats.descsFetched += 1;
      entries.push({ bvid, text: desc, kind: "desc", title: info.title });
    }
  }

  // —— 一次 LLM 提取（不可用则字典兜底） ——
  let schemes: BiliScheme[] = [];
  const ask = opts.ask ?? null;
  if (ask) {
    try {
      const raw = await ask(buildExtractMessages(keyword, entries));
      schemes = parseExtractReply(raw, entries, dict);
      stats.llmUsed = true;
    } catch {
      stats.llmUsed = false;
    }
  }
  if (!stats.llmUsed) schemes = extractByDictionary(entries, dict);

  for (const s of schemes) s.author = authorOf.get(s.bvid) ?? "";
  return { schemes, stats, failed: false };
}

/** 后台便捷封装：配置了 API 模式才启用 LLM（网页版模式退回字典兜底） */
export async function mineStageWithLlm(
  displayCode: string,
  dict: NameDict,
  opts: MineOptions = {},
): Promise<BiliMineResult> {
  // 不传 ask → 默认走配置的 API 模式；显式传 null → 只用字典兜底
  const ask: AskFn | null =
    opts.ask === undefined ? (messages: ChatMessage[]) => callLLM(messages) : opts.ask;
  return mineStage(displayCode, dict, { ...opts, ask });
}
