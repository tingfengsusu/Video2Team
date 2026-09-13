/**
 * 干员知识库（L1）：名字典 + 属性上下文（设计见 docs/design.md §3.3）。
 *
 * 只干两件杂活，不参与推荐：
 * 1. exists() —— 校验 AI 提取的干员名是否真实存在（防 LLM 幻觉）；
 * 2. get()    —— 给 LLM 推断替代时供属性上下文（职业/分支/费用/机制标签）。
 *
 * 数据：data/operators.json（来源 PRTS / 一图流开源数据，待定，见 docs/design.md §10）。
 */

import type { OperatorEntry } from "./types";

interface OperatorInfo {
  name: string;
  rarity?: number;
  profession?: string; // 职业
  branch?: string; // 分支
  cost?: number; // 费用
  tags?: string[]; // 机制标签
}

export class OperatorDB {
  private byName = new Map<string, OperatorInfo>();

  /** 从 data/operators.json 加载（打包为插件资源） */
  static async load(): Promise<OperatorDB> {
    throw new Error("not implemented: 待落地 data/operators.json（侦察任务）");
  }

  exists(name: string): boolean {
    return this.byName.has(name);
  }

  /** 属性上下文，供 LLM 推断替代时参考 */
  get(name: string): OperatorInfo | undefined {
    return this.byName.get(name);
  }

  toEntry(name: string): OperatorEntry | undefined {
    const info = this.byName.get(name);
    return info ? { name: info.name, elite: 0, level: 1, masteries: [] } : undefined;
  }
}
