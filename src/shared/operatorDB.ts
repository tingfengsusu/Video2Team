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

export class OperatorDB {
  private byName = new Map<string, OperatorInfo>();

  static async load(): Promise<OperatorDB> {
    // scripts/build.mjs 将 data/operators.json 拷贝至 dist/data/
    const url = chrome.runtime.getURL("data/operators.json");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`干员字典加载失败 HTTP ${resp.status}`);
    const raw: Record<string, any> = await resp.json();
    const db = new OperatorDB();
    for (const [charId, info] of Object.entries(raw)) {
      if (info?.name) db.byName.set(info.name, { charId, ...info });
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
