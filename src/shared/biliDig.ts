/**
 * §3 B站三级挖掘（补充数据源：实战视频与新打法）。
 *
 * 用于补充 MAA 源没有的视频实战内容（新干员单核、低配打法）。三级渐进：
 *   ① 搜索主标题   `x/web-interface/wbi/search/type?search_type=video&keyword=VEC-SP07`（wbi 签名）
 *   ② 命中合集的分P标题（view API 的 pages[].part，每合集 1 请求；
 *      默认「标题层干员不足 3 个」才拉，`partsThreshold: Infinity` 可强制必拉——候选池召回优先）
 *   ③ 简介补充（view API 的 desc，触发式：候选池 < 3 个干员时才拉）
 *
 * 三级语料合成后**一次 LLM 调用**提取 `{operators[], mode}`，
 * 结果再过干员名字典 + 纠错集校验（防幻觉）。LLM 不可用时退回确定性字典匹配。
 * 标题空心（没有任何干员名）的条目会被丢弃，不产生幻觉条目。
 *
 * ⚠️ 关卡归属（v4.3 二次实测）：合集视频的**大标题 + 各分P 干员并集**不是"本关阵容"。
 * 传 `stageHint` 后，只有明确指向本关的标题/分P 才被采纳（合集/区间标题与其它关的分P 丢弃），
 * 且命中分P 时 `title` 用分P 标题、`url` 带 `?p=` 直达那一关。
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
  title: string; // 来源标题：分P 命中时为**分P 标题**（如「VEC-SP12（蕾缪安二技能）」）
  operators: string[]; // 字典校验后的标准全名
  mode: string; // 单人 / 双人 / 低星 / 挂机 …（可空）
  author: string;
  kind: CorpusKind; // 命中层级
  page?: number; // 分P 序号（命中层级②时；用于 ?p= 直达与「分P」标注）
  collection?: string; // 所属合集/整视频标题（层级②时，供悬停溯源）
}

type CorpusKind = "title" | "part" | "desc";

interface CorpusEntry {
  bvid: string;
  text: string;
  kind: CorpusKind;
  title: string;
  page?: number;
  collection?: string;
}

// ---------- 关卡归属：一条语料到底说的是"本关"还是"整个合集" ----------

/** 文中的全部 VEC 显示码（规范化为 VEC-SP07 / VEC-C，去重保序） */
export function extractStageCodes(text: string): string[] {
  const s = String(text ?? "");
  const out: string[] = [];
  for (const m of s.matchAll(/VEC[\s_-]*(SP[\s_-]*\d{1,2}|[A-D](?:[\s_-]*\d{1,2})?)/gi)) {
    const suffix = (m[1] ?? "").toUpperCase().replace(/[\s_-]+/g, "");
    const code = `VEC-${suffix}`;
    if (!out.includes(code)) out.push(code);
  }
  // 裸写的「SP06」同样是关卡引用（实测合集标题写「VEC-SP05 SP06 SP07…」，
  // 分P 也常直接写「SP12 蕾缪安」；带「SP+数字」的其它语义极少见）
  for (const m of s.matchAll(/\bSP[\s_-]*(\d{1,2})\b/gi)) {
    const code = `VEC-SP${String(Number(m[1])).padStart(2, "0")}`;
    if (!out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * 是否"覆盖多关"的文本（合集标题 / 关卡区间 / 多模式罗列）。
 * 实测坑：`【特别战线】攻略合集VEC-SP-01~16`、`核心突破/特别战线/全力以赴 VEC-ABCD`
 * 这类大标题会把整个合集的干员并集算成"本关阵容"，必须排除。
 */
export function isMultiStageText(text: string): boolean {
  const s = String(text ?? "");
  if (/VEC[\s_-]*SP[\s_-]*\d{1,2}\s*[-~～—－至到]\s*\d{1,2}/i.test(s)) return true; // VEC-SP-01~16
  if (/全关卡|全部关卡|全套|全\s*SP|SP\s*[-0-9]*\s*全|合集|一览/i.test(s)) return true;
  const modes = ["核心突破", "特别战线", "全力以赴"].filter((k) => s.includes(k));
  if (modes.length >= 2) return true; // 同时提到多个玩法 = 覆盖多关
  return extractStageCodes(s).length > 1;
}

export type StageMatch = "target" | "other" | "unknown";

/**
 * 「序号 + 关卡内容」式分P 标题的序号匹配：`05缴械装备 令` / `12 蕾缪安二技能` / `VEC-SP12 单人`。
 *
 * 实测（2026-10-08）：特别战线合集的干货分P 常写成「NN<补给名> <干员>」——
 * 序号即关卡编号（05 = VEC-SP05），补给名（缴械装备等）不在关卡库里，只能靠序号归属。
 * 仅在**父视频标题确认是关卡清单**（合集/特别战线/VEC）时才允许这条兜底，避免误挂。
 */
export function partNumberMatches(partTitle: string, displayCode: string): boolean {
  const num = /(\d{1,2})\s*$/.exec(String(displayCode ?? "").trim())?.[1];
  if (!num) return false;
  const wanted = String(Number(num));
  const m = /^\s*(?:p|第)?\s*0*(\d{1,2})(?![0-9])/i.exec(String(partTitle ?? ""));
  return !!m && String(Number(m[1])) === wanted;
}

/** 视频标题是否"看起来就是关卡清单"（合集 / 特别战线 / 含 SP 或 VEC 码） */
export function looksLikeStageList(title: string): boolean {
  const s = String(title ?? "");
  return isMultiStageText(s) || /特别战线|VEC|SP[\s_-]*\d/i.test(s);
}

/** 判断一段文本（标题 / 分P 标题 / 简介）说的是不是目标关：
 * - `target`：唯一关卡码就是目标关，或没写码但出现了目标关中文名；
 * - `other`：写的是别的关；
 * - `unknown`：区间/合集/多码，无法归属到单关（宁可不采纳，也不把合集干员并集算到本关）。
 */
export function matchStageText(text: string, target: { code?: string; name?: string }): StageMatch {
  const s = String(text ?? "");
  const code = String(target.code ?? "").trim().toUpperCase();
  const codes = extractStageCodes(s);
  // 区间/合集/多玩法罗列 → 无法归属到单关（即便包含目标关的码，也不能用它的干员并集）
  if (isMultiStageText(s)) return "unknown";
  if (codes.length === 0) {
    const name = String(target.name ?? "").trim();
    return name && s.includes(name) ? "target" : "unknown";
  }
  if (codes.length === 1) return codes[0] === code ? "target" : "other";
  return codes.includes(code) ? "unknown" : "other";
}


export interface BiliMineStats {
  searched: number; // 搜索结果条数
  pagesSearched: number;
  partsFetched: number; // 层级②触发的合集数
  descsFetched: number; // 层级③触发的简介数
  /** 因不指向本关（合集大标题 / 其它关的分P）被丢弃的语料条数 */
  skippedEntries: number;
  /** 因发布时间超出时间范围（上一期活动等）被丢弃的搜索结果条数 */
  expiredSkipped: number;
  llmUsed: boolean; // 是否走了 LLM 精筛（false = 字典兜底）
}

export interface BiliMineResult {
  schemes: BiliScheme[];
  stats: BiliMineStats;
  /** 搜索阶段完全失败（无网络 / 风控）时为 true → 调用方静默跳过 B站源 */
  failed: boolean;
}

export interface MineOptions {
  pages?: number; // 搜索页数（默认 2，1-5；页数越多召回越高）
  maxPartsVideos?: number; // 层级②最多拉几个合集（默认 5）
  maxDescVideos?: number; // 层级③最多拉几个简介（默认 8）
  /**
   * 只要最近 N 天发布的视频（默认 180；0 = 不限）。
   * 实测脏数据：`VEC-SP12 最低练度`（504 天前 = 上一期活动）会被搜出来，但那一期的阵容/机制未必适用本期。
   * ⚠️ B站搜索接口的 `pubtime_begin_s` 实测**不生效**（旧视频照样返回），因此以**本地 pubdate 过滤**为准。
   */
  maxAgeDays?: number;
  /**
   * 层级②的分P 抓取门槛：标题层算出的不同干员数 **低于** 该值才拉分P（默认 3）。
   * 传 `Infinity` = 必拉（候选池召回优先时用：分P 标题是最有信息量的一层，
   * 实测「VEC-SP05 令」这种「关卡+干员」对全在分P里）。
   */
  partsThreshold?: number;
  /**
   * 目标关身份（显示码 + 中文名）。给了就对每条语料做**关卡归属过滤**：
   * 合集大标题（VEC-SP-01~16 / 全关卡 / 多玩法罗列）与其它关的分P 一律不采纳，
   * 避免把整个合集的干员并集当成"本关阵容"；只有明确指向本关的标题/分P 才产出方案。
   */
  stageHint?: { displayCode?: string; stageName?: string };
  ask?: AskFn | null; // LLM 调用器；不传则只用字典兜底
}

/** 发布时间是否在最近 maxAgeDays 天内（0 = 不限；pubdate 缺失/异常时不判过期，避免误杀） */
export function withinMaxAge(pubdateSec: number, nowMs: number, maxAgeDays: number): boolean {
  if (!maxAgeDays || maxAgeDays <= 0) return true;
  const ts = Number(pubdateSec);
  if (!Number.isFinite(ts) || ts <= 0) return true;
  return nowMs / 1000 - ts <= maxAgeDays * 86400;
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

/** 分P 直达链接：命中分P 时带 ?p=（实测坑：不带就永远落在 P1，不是对应的那一关） */
function videoUrl(bvid: string, page?: number): string {
  const base = `https://www.bilibili.com/video/${bvid}`;
  return page && page > 1 ? `${base}?p=${page}` : base;
}

function schemeOf(entry: CorpusEntry, ops: string[], mode: string): BiliScheme {
  return {
    bvid: entry.bvid,
    url: videoUrl(entry.bvid, entry.page),
    title: entry.title,
    operators: ops,
    mode,
    author: "",
    kind: entry.kind,
    page: entry.page,
    collection: entry.collection,
  };
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
    const key = `${entry.bvid}|${entry.page ?? 0}|${ops.join("+")}|${entry.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(schemeOf(entry, ops, String(s?.mode ?? "").trim() || detectMode(entry.text)));
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
    const key = `${entry.bvid}|${entry.page ?? 0}|${ops.join("+")}|${entry.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(schemeOf(entry, ops, detectMode(entry.text)));
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
  const pages = Math.max(1, Math.min(5, Math.trunc(opts.pages ?? 2)));
  const maxPartsVideos = Math.max(0, opts.maxPartsVideos ?? 5);
  const maxDescVideos = Math.max(0, opts.maxDescVideos ?? 8);
  // 注意：不能写 Number.isFinite（Infinity 会被判为 false 而退回 3）——Infinity 是"必拉分P"的合法取值
  const rawThreshold = opts.partsThreshold === undefined ? 3 : Number(opts.partsThreshold);
  const partsThreshold = Number.isNaN(rawThreshold) ? 3 : rawThreshold;
  const stats: BiliMineStats = {
    searched: 0,
    pagesSearched: 0,
    partsFetched: 0,
    descsFetched: 0,
    skippedEntries: 0,
    expiredSkipped: 0,
    llmUsed: false,
  };

  const keyword = displayCode.trim();
  if (!keyword) return { schemes: [], stats, failed: true };
  const maxAgeDays = Math.max(0, Math.trunc(opts.maxAgeDays ?? 180));
  const nowMs = Date.now();
  const freshOnly = (it: SearchVideoItem): boolean => {
    if (withinMaxAge(it.pubdate, nowMs, maxAgeDays)) return true;
    stats.expiredSkipped += 1;
    return false;
  };

  // —— ① 主标题搜索 ——
  // 先按显示码搜；显示码几乎搜不到本关内容时再用关卡中文名补搜 1 页
  // （实测部分视频标题只写关名不写码；关名可能是通用词，补搜结果仍要过归属过滤）
  const nameKeyword = String(opts.stageHint?.stageName ?? "").trim();
  const items: SearchVideoItem[] = [];
  const seenBvid = new Set<string>();
  let searchOk = false;
  const searchAndCollect = async (kw: string, pageCount: number): Promise<void> => {
    for (let page = 1; page <= pageCount; page += 1) {
      try {
        const got = await searchVideos(kw, {
          page,
          pageSize: 20,
          // 服务端筛选尽力而为（实测该参数目前不生效，本地 pubdate 过滤才是准的）
          pubtimeBeginS: maxAgeDays > 0 ? Math.floor(nowMs / 1000) - maxAgeDays * 86400 : undefined,
        });
        stats.pagesSearched += 1;
        searchOk = true;
        if (!got.length) break;
        for (const it of got) {
          if (seenBvid.has(it.bvid)) continue;
          if (!freshOnly(it)) continue; // 上一期活动/旧攻略：按发布时间挡掉
          seenBvid.add(it.bvid);
          items.push(it);
        }
      } catch {
        break; // 单页失败即停止翻页
      }
    }
  };

  // 主关键词（显示码）：标题/简介里明确指向本关
  await searchAndCollect(keyword, pages);
  const target = { code: keyword, name: opts.stageHint?.stageName };
  const filterByStage = !!opts.stageHint;
  const belongsToTarget = (text: string): boolean =>
    !filterByStage || matchStageText(text, target) === "target";
  let titleEntries = toEntries(items).filter((e) => belongsToTarget(e.text));

  // 关名补搜：**每关都跑 1 页**（实测某条标题只写码的视频排在码搜索 40 名之外，
  // 但用关卡中文名搜能进前 20；关名可能是通用词，结果仍要过归属过滤）
  if (nameKeyword && nameKeyword !== keyword) {
    await searchAndCollect(nameKeyword, 1);
    titleEntries = toEntries(items).filter((e) => belongsToTarget(e.text));
  }
  // entries 从标题层起步，后续分P / 简介层往里追加（同一个可变数组）
  const entries: CorpusEntry[] = [...titleEntries];
  stats.searched = items.length;
  if (!searchOk && items.length === 0) return { schemes: [], stats, failed: true };
  stats.skippedEntries = toEntries(items).length - entries.length;
  const authorOf = new Map(items.map((i) => [i.bvid, i.author]));
  const index = buildNameIndex(dict);
  const distinctCount = (): number => {
    const set = new Set<string>();
    for (const e of entries) for (const op of matchOperators(e.text, dict, index)) set.add(op);
    return set.size;
  };

  // —— ② 命中合集的分P标题（候选不足时才拉；partsThreshold=Infinity 时必拉） ——
  // 分P 标题是「关卡 + 干员」的最佳载体（「VEC-SP12 玛恩纳流明3技能」就是一套方案）。
  // 合集类视频优先排查，随后按搜索结果顺序；只采纳指向本关的分P，并记住 ?p= 页码。
  if (distinctCount() < partsThreshold && maxPartsVideos > 0 && items.length) {
    // 抓谁的分P（分桶，避免"合集"把名额占完）：
    //   ① 合集/多关标题（≤3）② 标题指向本关且**列了 ≥3 个干员**的多解视频（≤3，
    //      实测 BV1C2Hi6AEHc 标题列了 玛恩纳/流明/怒潮凛冬，4 个分P 各是一套方案）③ 其余按搜索顺序
    const collections: SearchVideoItem[] = [];
    const multiOp: SearchVideoItem[] = [];
    const rest: SearchVideoItem[] = [];
    for (const it of items) {
      const text = `${it.title} ｜ ${it.description}`;
      if (isMultiStageText(it.title)) collections.push(it);
      else if (matchStageText(text, target) === "target" && matchOperators(text, dict, index).length >= 3) {
        multiOp.push(it);
      } else rest.push(it);
    }
    const targets = [
      ...collections.slice(0, 3),
      ...multiOp.slice(0, 3),
      ...rest.slice(0, Math.max(0, maxPartsVideos - collections.slice(0, 3).length - multiOp.slice(0, 3).length)),
    ].map((it) => it.bvid);
    const infos = await fetchVideoInfos(targets);
    for (const [bvid, info] of infos) {
      if (info.pages.length < 2) continue;
      stats.partsFetched += 1;
      // 父视频标题要像"关卡清单"，才允许按分P 序号兜底归属（避免误挂）
      const numbered = looksLikeStageList(info.title);
      // 父视频标题**只指向本关**（unique 码 = 本关）：分P 里没写关卡信息时，
      // 它们就是本关的多套打法（实测 BV1C2Hi6AEHc：标题写 VEC-SP12，4 个分P 是
      // 「玛恩纳流明3技能」「怒潮凛冬7级3技能流明7级一技能」等不同解）
      const parentIsTarget =
        matchStageText(`${info.title} ｜ ${info.desc}`, target) === "target";
      for (const pg of info.pages) {
        const part = stripHighlight(pg.part);
        if (!part) continue;
        const matched = matchStageText(part, target);
        // 序号兜底：合集分P 常写「05缴械装备 令」（补给名不在关卡库，只能靠序号归属）
        const byNumber = matched === "unknown" && numbered && partNumberMatches(part, keyword);
        // 父视频层级兜底：分P 既没写本关也没写别关（unknown）→ 随父视频归本关
        const byParent = matched === "unknown" && parentIsTarget;
        if (matched !== "target" && !byNumber && !byParent) {
          stats.skippedEntries += 1;
          continue;
        }
        entries.push({
          bvid,
          text: part,
          kind: "part",
          title: part,
          page: pg.page,
          collection: stripHighlight(info.title),
        });
      }
    }

    // ⚠️ 有分P 命中的视频：**丢弃它的标题层条目**。
    // 实测 BV1C2Hi6AEHc（『矢量突破』VEC-SP12 四号站台 玛恩纳 流明…）：标题只说本关，
    // 但 4 个分P 各是一套方案（玛恩纳流明3技能 / 7级二技能 / 怒潮凛冬…）；
    // 保留标题层会把干员**并成一条**、把分P 的具体打法丢掉。
    const partHitBvids = new Set(
      entries.filter((e) => e.kind === "part").map((e) => e.bvid),
    );
    if (partHitBvids.size) {
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const e = entries[i]!;
        if (e.kind === "title" && partHitBvids.has(e.bvid)) {
          entries.splice(i, 1);
          stats.skippedEntries += 1;
        }
      }
    }
  }

  // —— ③ 简介补充（仍不足时才拉） ——
  if (distinctCount() < 3 && maxDescVideos > 0 && items.length) {
    const targets = items.slice(0, maxDescVideos).map((i) => i.bvid);
    const infos = await fetchVideoInfos(targets);
    for (const [bvid, info] of infos) {
      const desc = stripHighlight(info.desc);
      if (!desc || !belongsToTarget(desc)) continue;
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
