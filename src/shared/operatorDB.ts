/**
 * 干员知识库（L1）：名字典 + 属性上下文（设计见 docs/design.md §3.3）。
 *
 * 只干两件杂活，不参与推荐：
 * 1. exists()/resolve() —— 校验 AI 提取的干员名（防 LLM 幻觉），别名还原为全名；
 * 2. get()             —— 给 LLM 推断替代时供属性上下文（职业/分支/费用/机制标签）。
 *
 * 数据：data/operators.json（一图流 character_table_simple.v2.json 预处理产物）
 * + data/aliases.json 纠错集（昵称/黑话 → 全名，运行时积累）。
 */

import ALIASES from "../../data/aliases.json";
import type { OperatorEntry } from "./types";

export interface OperatorInfo {
  name: string;
  charId: string;
  profession?: string; // 职业（SNIPER/WARRIOR/...）
  branch?: string; // 分支 subProfessionId
  rarity?: number; // 0-indexed（一图流原值：5 = 五星）
  skills?: string[]; // 技能名（可用于校验阵容中的技能）
}

const ALIAS_MAP = new Map<string, string>(Object.entries(ALIASES.aliases));

// ---------- 干员字典数据源（在线优先 + 缓存 + 打包兜底） ----------

const REMOTE_SOURCES = [
  // 上游一图流数据（国内可达的 jsDelivr 优先）
  "https://cdn.jsdelivr.net/gh/Arknights-yituliu/frontend-v2-plus@main/src/static/json/operator/character_table_simple.v2.json",
  "https://raw.githubusercontent.com/Arknights-yituliu/frontend-v2-plus/main/src/static/json/operator/character_table_simple.v2.json",
];
const CACHE_KEY = "operators_remote";
const CACHE_TTL = 24 * 3600 * 1000; // 24 小时

type OperatorTable = Record<string, { name?: string; skills?: unknown } & Record<string, unknown>>;

async function loadOperatorTable(): Promise<OperatorTable> {
  // ① 缓存
  try {
    const stored = (await chrome.storage.local.get(CACHE_KEY)) as Record<
      string,
      { ts: number; data: OperatorTable } | undefined
    >;
    const c = stored[CACHE_KEY];
    if (c && Date.now() - c.ts < CACHE_TTL && c.data && Object.keys(c.data).length > 0) {
      return c.data;
    }
  } catch {
    /* 存储不可用时继续走远程/打包 */
  }

  // ② 远程（失败逐个尝试，成功后写入缓存）
  for (const url of REMOTE_SOURCES) {
    try {
      const resp = await fetch(url, { cache: "no-cache" });
      if (!resp.ok) continue;
      const data = (await resp.json()) as OperatorTable;
      if (data && Object.keys(data).length > 100) {
        void chrome.storage.local.set({ [CACHE_KEY]: { ts: Date.now(), data } }).catch?.(() => {});
        return data;
      }
    } catch {
      /* 尝试下一个源 */
    }
  }

  // ③ 打包内兜底（离线/远程被墙时）
  const resp = await fetch(chrome.runtime.getURL("data/operators.json"));
  if (!resp.ok) throw new Error(`干员字典加载失败 HTTP ${resp.status}`);
  return (await resp.json()) as OperatorTable;
}

export class OperatorDB {
  private byName = new Map<string, OperatorInfo>();

  /**
   * 加载干员字典（2026-09-16：在线优先，保证新干员及时入库）：
   * ① local 缓存未过期（24h）直接用 → ② 依次尝试远程源（jsDelivr 国内可达 / raw GitHub）
   * → ③ 全部失败回退打包内副本（离线可用）。远程/本地数据格式一致（charId → {name,profession,...}）。
   */
  static async load(): Promise<OperatorDB> {
    const raw = await loadOperatorTable();
    const db = new OperatorDB();
    for (const [charId, info] of Object.entries(raw)) {
      if (!info?.name) continue;
      // 兼容上游原始格式：skills 可能是 [{skillName}] 而非 ["技能名"]
      const skills = Array.isArray(info.skills)
        ? info.skills
            .map((s: unknown) => (typeof s === "string" ? s : (s as { skillName?: string })?.skillName))
            .filter((s): s is string => !!s)
        : undefined;
      db.byName.set(info.name, { charId, ...info, name: info.name, skills } as OperatorInfo);
    }
    return db;
  }

  /** 别名 → 干员全名（未命中返回原名） */
  resolve(name: string): string {
    const trimmed = name.trim();
    return ALIAS_MAP.get(trimmed) ?? trimmed;
  }

  exists(name: string): boolean {
    return this.byName.has(this.resolve(name));
  }

  /** 属性上下文，供 LLM 推断替代时参考 */
  get(name: string): OperatorInfo | undefined {
    return this.byName.get(this.resolve(name));
  }

  toEntry(name: string): OperatorEntry | undefined {
    const info = this.get(name);
    if (!info) return undefined;
    return {
      name: info.name,
      owned: true,
      rarity: (info.rarity ?? 0) + 1, // 一图流 rarity 0-indexed → 星级 1-indexed
      level: 1,
      elite: 0,
      masteries: [],
    };
  }
}
