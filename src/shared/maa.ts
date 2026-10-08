/**
 * MAA 作业站（https://prts.maa.plus，前后端开源：ZOOT-Plus）数据源。
 *
 * 派遣关（矢量突破类活动的 `_spXX` 关）结构化作业的**第一数据源**：
 * 每条作业的 `content` 字段内嵌完整作业 JSON，`opers[].name` 是游戏标准全名，
 * 因此零别名还原、零 OCR、零幻觉 —— 可与用户 box 直接比较。
 *
 * 实测（2026-10-08）：
 * - `GET /arknights/level` → `{status_code, data:[{cat_three:"VEC-SP07", stage_id:"act3break_sp07", name, cat_two}]}`
 * - `GET /copilot/query?levelKeyword=...&page=1&limit=...&orderBy=hot_score&desc=true`
 *   → `{status_code, data:{has_next, page, total, data:[{id, uploader, views, hot_score, content:"{...}"}]}}`
 * - 显示码 ↔ 内部码**不是数字对应**（VEC-SP11 ↔ act3break_sp07），必须查关卡库。
 *
 * 无网络 / 接口异常时所有函数返回空结果，由调用方静默降级到 B站挖掘（§3）。
 */

const LEVEL_DB_URL = "https://prts.maa.plus/arknights/level";
const COPILOT_QUERY_URL = "https://prts.maa.plus/copilot/query";

const LEVEL_DB_KEY = "maaLevelDb";
const LEVEL_DB_TTL_MS = 24 * 60 * 60 * 1000;

/** 单个关卡库条目（规范化：去掉 `_stage_id#f#` 之类的后缀） */
export interface MaaLevel {
  stageId: string; // 内部码，如 act3break_sp07
  displayCode: string; // 显示码，如 VEC-SP07
  name: string; // 关卡中文名，如 投资回报
  eventName: string; // 活动名，如 矢量突破#3 拟生态
}

/** 作业中的干员条目 */
export interface MaaOper {
  name: string;
  skill?: number; // 技能编号 1-3
  skillUsage?: number; // 技能用法（MAA 语义：0=好了就开 …）
}

/** 一条解析后的作业方案 */
export interface MaaScheme {
  copilotId: number;
  stageId: string; // 作业声明的 stage_name（内部码）
  displayCode: string; // 关卡库反查的显示码（查不到为空串）
  stageName: string; // 关卡库反查的关卡中文名
  title: string; // 作业标题（作者手写，含显示码，仅展示）
  details: string; // 作业说明
  opers: MaaOper[]; // 固定干员
  groups: { name: string; opers: MaaOper[] }[]; // 任选一组的可选干员
  uploader: string;
  uploaderId: string;
  views: number;
  hotScore: number;
}

/** 某个派遣关的候选方案池（§2 输出 → 与 §3 的 B站池合并） */
export interface DispatchStagePool {
  displayCode: string;
  stageId: string;
  stageName: string;
  schemes: MaaScheme[];
}

// ---------- 极简 KV 存储（chrome.storage.local；Node 自测时退化为内存） ----------

const memoryStore = new Map<string, unknown>();

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local;
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  if (hasChromeStorage()) {
    const stored = (await chrome.storage.local.get(key)) as Record<string, T | undefined>;
    return stored[key];
  }
  return memoryStore.get(key) as T | undefined;
}

async function kvSet(key: string, value: unknown): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  memoryStore.set(key, value);
}

// ---------- 关卡库 ----------

interface LevelDbCache {
  ts: number;
  levels: MaaLevel[];
}

function normalizeLevel(raw: unknown): MaaLevel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  // stage_id 可能带 "#f#"（突袭/固定编队标记）等后缀，取 "#" 前
  const stageId = String(r.stage_id ?? "").split("#")[0]?.trim() ?? "";
  const displayCode = String(r.cat_three ?? "").trim();
  if (!stageId || !displayCode) return null;
  return {
    stageId,
    displayCode,
    name: String(r.name ?? "").trim(),
    eventName: String(r.cat_two ?? "").trim(),
  };
}

let levelDbMemo: { ts: number; levels: MaaLevel[] } | null = null;

/**
 * 拉取关卡库（3500+ 条），chrome.storage.local 缓存 24h。
 * 拉取失败时返回过期缓存（如果有），全失败返回 []。
 */
export async function getLevelDb(opts: { force?: boolean } = {}): Promise<MaaLevel[]> {
  const now = Date.now();
  if (!opts.force && levelDbMemo && now - levelDbMemo.ts < LEVEL_DB_TTL_MS && levelDbMemo.levels.length) {
    return levelDbMemo.levels;
  }

  let cached: LevelDbCache | undefined;
  try {
    cached = await kvGet<LevelDbCache>(LEVEL_DB_KEY);
  } catch {
    /* 存储不可用 → 走网络 */
  }
  if (!opts.force && cached?.levels?.length && now - cached.ts < LEVEL_DB_TTL_MS) {
    levelDbMemo = { ts: cached.ts, levels: cached.levels };
    return cached.levels;
  }

  try {
    const resp = await fetch(LEVEL_DB_URL, { cache: "no-cache" });
    if (resp.ok) {
      const json = (await resp.json()) as { data?: unknown };
      const levels = Array.isArray(json.data)
        ? json.data.map(normalizeLevel).filter((l): l is MaaLevel => !!l)
        : [];
      if (levels.length) {
        levelDbMemo = { ts: now, levels };
        await kvSet(LEVEL_DB_KEY, { ts: now, levels } satisfies LevelDbCache);
        return levels;
      }
    }
  } catch {
    /* 网络异常 → 静默降级 */
  }

  if (cached?.levels?.length) {
    levelDbMemo = { ts: cached.ts, levels: cached.levels };
    return cached.levels;
  }
  return [];
}

/** 从 stage_id 提取活动内部前缀：act3break_sp07 → act3break */
export function eventPrefixFromStageId(stageId: string): string {
  const id = stageId.trim().split("#")[0] ?? "";
  // 去掉末尾的 `_sp07` / `_ex02` / `_h03` / `_12` 之类的关卡后缀
  const m = /^(.*?)_([a-z]{0,3}\d+)$/i.exec(id);
  return (m?.[1] ?? id).toLowerCase();
}

/** 从活动前缀提取活动序号：act3break → 3（用于在多次复刻中选最新） */
function activityIndex(stageId: string): number {
  const m = /^act(\d+)/i.exec(stageId);
  return m ? Number(m[1]) : 0;
}

/**
 * 显示码 → 活动内部前缀（如 VEC-01 → act3break）。
 *
 * 同一显示码在多次活动中重复出现（VEC-SP07 同时存在于 act1break/act2break/act3break），
 * 因此默认取**活动序号最大**的那期（当前在打的）。可传 eventName 精确限定。
 * 解析不到时返回空串。
 */
export async function resolveEventPrefix(
  displayCode: string,
  opts: { eventName?: string } = {},
): Promise<string> {
  const code = displayCode.trim().toUpperCase();
  if (!code) return "";
  const levels = await getLevelDb();
  let matches = levels.filter((l) => l.displayCode.toUpperCase() === code);
  if (opts.eventName) {
    const hint = opts.eventName.trim();
    const exact = matches.filter((l) => l.eventName === hint || l.eventName.includes(hint));
    if (exact.length) matches = exact;
  }
  if (!matches.length) return "";
  matches.sort((a, b) => activityIndex(b.stageId) - activityIndex(a.stageId));
  return eventPrefixFromStageId(matches[0]!.stageId);
}

/**
 * 某活动（内部前缀，如 act3break）的全部**派遣关**清单。
 * 派遣关 = stage_id 形如 `{prefix}_spXX`。
 */
export async function listDispatchStages(eventPrefix: string): Promise<MaaLevel[]> {
  const prefix = eventPrefix.trim().toLowerCase();
  if (!prefix) return [];
  const levels = await getLevelDb();
  return levels
    .filter((l) => {
      const p = eventPrefixFromStageId(l.stageId);
      if (p !== prefix) return false;
      const tail = l.stageId.slice(prefix.length + 1);
      return /^sp\d+$/i.test(tail);
    })
    .sort((a, b) => a.displayCode.localeCompare(b.displayCode, "en", { numeric: true }));
}

// ---------- 作业查询 ----------

interface CopilotQueryItem {
  id?: unknown;
  uploader?: unknown;
  uploader_id?: unknown;
  views?: unknown;
  hot_score?: unknown;
  content?: unknown;
}

function normalizeOper(raw: unknown): MaaOper | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const name = String(r.name ?? "").trim();
  if (!name) return null;
  const skill = Number(r.skill);
  const skillUsage = Number(r.skill_usage);
  return {
    name,
    skill: Number.isFinite(skill) && skill > 0 ? skill : undefined,
    skillUsage: Number.isFinite(skillUsage) ? skillUsage : undefined,
  };
}

/** 解析 item.content（作业 JSON 字符串）。兼容旧版「纯 opers 数组」格式。 */
function parseCopilotContent(content: unknown): {
  stageId: string;
  title: string;
  details: string;
  opers: MaaOper[];
  groups: { name: string; opers: MaaOper[] }[];
} | null {
  if (typeof content !== "string" || !content.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null; // 少量坏数据直接跳过，不报错
  }

  // 旧版格式：content 直接是干员数组
  if (Array.isArray(parsed)) {
    return {
      stageId: "",
      title: "",
      details: "",
      opers: parsed.map(normalizeOper).filter((o): o is MaaOper => !!o),
      groups: [],
    };
  }
  if (!parsed || typeof parsed !== "object") return null;

  const p = parsed as Record<string, unknown>;
  const doc = (p.doc && typeof p.doc === "object" ? p.doc : {}) as Record<string, unknown>;
  const groupsRaw = Array.isArray(p.groups) ? p.groups : [];
  const groups = groupsRaw
    .map((g) => {
      if (!g || typeof g !== "object") return null;
      const gr = g as Record<string, unknown>;
      const opers = (Array.isArray(gr.opers) ? gr.opers : [])
        .map(normalizeOper)
        .filter((o): o is MaaOper => !!o);
      if (!opers.length) return null;
      return { name: String(gr.name ?? "").trim() || "可选组", opers };
    })
    .filter((g): g is { name: string; opers: MaaOper[] } => !!g);

  return {
    stageId: String(p.stage_name ?? "").trim(),
    title: String(doc.title ?? "").trim(),
    details: String(doc.details ?? "").trim(),
    opers: (Array.isArray(p.opers) ? p.opers : [])
      .map(normalizeOper)
      .filter((o): o is MaaOper => !!o),
    groups,
  };
}

export interface QueryCopilotsResult {
  schemes: MaaScheme[];
  total: number;
  page: number;
  hasNext: boolean;
  /** 查询失败 / 无网络时为 true（调用方据此静默降级） */
  failed: boolean;
}

/**
 * 按内部码（支持前缀，如 act3break_sp）查询作业列表，并解析 content。
 * 失败时返回空 schemes + `failed: true`，不抛异常。
 */
export async function queryCopilots(
  levelKeyword: string,
  opts: { page?: number; limit?: number; orderBy?: string; desc?: boolean } = {},
): Promise<QueryCopilotsResult> {
  const keyword = levelKeyword.trim();
  const page = Math.max(1, Math.trunc(opts.page ?? 1));
  const limit = Math.min(50, Math.max(1, Math.trunc(opts.limit ?? 20)));
  const orderBy = opts.orderBy ?? "hot_score";
  const desc = opts.desc !== false;
  const empty: QueryCopilotsResult = { schemes: [], total: 0, page, hasNext: false, failed: true };
  if (!keyword) return empty;

  let json: { data?: unknown };
  try {
    const url =
      `${COPILOT_QUERY_URL}?levelKeyword=${encodeURIComponent(keyword)}` +
      `&page=${page}&limit=${limit}&orderBy=${encodeURIComponent(orderBy)}&desc=${desc ? "true" : "false"}`;
    const resp = await fetch(url, { cache: "no-cache" });
    if (!resp.ok) return empty;
    json = (await resp.json()) as { data?: unknown };
  } catch {
    return empty;
  }

  const data = (json.data && typeof json.data === "object" ? json.data : {}) as Record<string, unknown>;
  const items: CopilotQueryItem[] = Array.isArray(data.data) ? (data.data as CopilotQueryItem[]) : [];
  const levels = await getLevelDb().catch(() => []);
  const byStageId = new Map(levels.map((l) => [l.stageId, l]));
  // 实测坑：无法匹配的 keyword 会被后端忽略并返回**全站**作业（total 4 万+）。
  // 因此当 keyword 形如内部码（act3break_sp）时，客户端再按 stage_name 前缀兜底过滤一次。
  const stageIdLike = /^[A-Za-z0-9_]+$/.test(keyword);
  const lowerKeyword = keyword.toLowerCase();

  const schemes: MaaScheme[] = [];
  for (const item of items) {
    const parsed = parseCopilotContent(item.content);
    if (!parsed || (!parsed.opers.length && !parsed.groups.length)) continue;
    if (stageIdLike && !parsed.stageId.toLowerCase().startsWith(lowerKeyword)) continue;
    const level = byStageId.get(parsed.stageId);
    schemes.push({
      copilotId: Number(item.id) || 0,
      stageId: parsed.stageId,
      displayCode: level?.displayCode ?? "",
      stageName: level?.name ?? "",
      title: parsed.title,
      details: parsed.details,
      opers: parsed.opers,
      groups: parsed.groups,
      uploader: String(item.uploader ?? "").trim(),
      uploaderId: String(item.uploader_id ?? "").trim(),
      views: Number(item.views) || 0,
      hotScore: Number(item.hot_score) || 0,
    });
  }

  return {
    schemes,
    total: Number(data.total) || schemes.length,
    page: Number(data.page) || page,
    // keyword 被后端忽略时本页会被全部过滤掉 → 视为没有下一页，避免空翻页
    hasNext: data.has_next === true && (!stageIdLike || schemes.length > 0),
    failed: false,
  };
}

/**
 * 一次前缀查询产出**全部派遣关**的候选池（§2 验收：
 * `act3break_sp` → 该活动所有派遣关的候选方案）。
 */
export async function buildDispatchPool(
  eventPrefix: string,
  opts: { perStageLimit?: number; pageSize?: number; maxPages?: number } = {},
): Promise<DispatchStagePool[]> {
  const prefix = eventPrefix.trim().toLowerCase();
  if (!prefix) return [];
  const pageSize = Math.min(50, Math.max(1, opts.pageSize ?? 50));
  const maxPages = Math.max(1, opts.maxPages ?? 4);
  const perStageLimit = Math.max(1, opts.perStageLimit ?? 8);

  const stages = await listDispatchStages(prefix);
  const collected: MaaScheme[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const res = await queryCopilots(`${prefix}_sp`, { page, limit: pageSize });
    if (res.failed || res.schemes.length === 0) break;
    collected.push(...res.schemes);
    if (!res.hasNext) break;
  }

  const byDisplay = new Map<string, DispatchStagePool>();
  // 先按关卡库建好空池，保证“无作业的关”也不缺项
  for (const s of stages) {
    byDisplay.set(s.displayCode, {
      displayCode: s.displayCode,
      stageId: s.stageId,
      stageName: s.name,
      schemes: [],
    });
  }
  for (const scheme of collected) {
    const key = scheme.displayCode || scheme.stageId;
    if (!key) continue;
    let pool = byDisplay.get(key);
    if (!pool) {
      pool = {
        displayCode: scheme.displayCode,
        stageId: scheme.stageId,
        stageName: scheme.stageName,
        schemes: [],
      };
      byDisplay.set(key, pool);
    }
    if (pool.schemes.length < perStageLimit) pool.schemes.push(scheme);
  }

  return [...byDisplay.values()].sort((a, b) =>
    a.displayCode.localeCompare(b.displayCode, "en", { numeric: true }),
  );
}

/** 清空关卡库缓存（设置页「清空分析缓存」时一并调用） */
export async function clearLevelDbCache(): Promise<void> {
  levelDbMemo = null;
  if (hasChromeStorage()) await chrome.storage.local.remove(LEVEL_DB_KEY);
  else memoryStore.delete(LEVEL_DB_KEY);
}
