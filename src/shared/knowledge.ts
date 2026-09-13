/**
 * ②b 泛化替代知识提取（L2，v1）：从视频图表帧提取 UP 主整理的替换分析知识。
 *
 * 数据来源是简评/池子分析类视频中的「挂机替换概率/问题」类表格
 * （干员 × 可替换的情况 × 可能出现的问题）。
 * 流程：抽帧（可选本地服务）→ 图表帧检测 → DeepSeek 多模态提取
 *      → 干员名字典校验 → 入库（chrome.storage）。
 * 注意：图表底部的语义注解（如「替换指的是攻奶不换，部署位置不换」）
 * 必须保留到 semantics 字段。
 */

import type { GenericSubstitution } from "./types";

/** v1：依赖可选本地分析服务的抽帧能力 */
export async function extractGenericKnowledge(
  videoId: string,
): Promise<GenericSubstitution[]> {
  throw new Error("not implemented: v1");
}
