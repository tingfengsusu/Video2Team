/**
 * 核心数据模型（设计见 docs/design.md §5）。
 * 分析管道中流动的四类结构 + 替换类型常量。
 */

/** 替换类型：L2 图表底部的语义注解表明替代是多粒度的 */
export const KIND_OPERATOR_SWAP = "operator_swap" as const; // 换干员（默认）
export const KIND_SKILL_SWAP = "skill_swap" as const; // 换技能/攻速
export const KIND_POSITION_SWAP = "position_swap" as const; // 换部署位置
export const KIND_MANUAL = "manual" as const; // 该格放弃挂机，改手动操作

export type SubstitutionKind =
  | typeof KIND_OPERATOR_SWAP
  | typeof KIND_SKILL_SWAP
  | typeof KIND_POSITION_SWAP
  | typeof KIND_MANUAL;

/** 原阵容中的一个槽位 */
export interface RosterSlot {
  operator: string; // 干员名（须过 operatorDB 校验）
  skill?: number; // 技能编号
  mastery?: number; // 专精等级
  deployOrder?: number; // 部署顺序
  isKey: boolean; // 关键位标记
  keyReason?: string; // 关键原因（来自解说/简介/置顶评论）
  support?: boolean; // 助战干员（好友干员，不在用户 box）
}

/** ① 阵容提取的输出：单个关卡对应的阵容 */
export interface Roster {
  stage: string; // 关卡名，如 "EX-8"
  videoId: string; // 来源视频 BV 号
  page: number | null; // 分P索引（多分P合集形态）；独立视频为 null
  slots: RosterSlot[];
  source: "screenshot" | "description" | "pinned_comment" | "ocr_llm";
}

/** ②a 实战替代挖掘的输出（L3）：关卡绑定的「谁可以被谁替」建议 */
export interface Substitution {
  removed: string; // 视频阵容中被替换的干员
  replacement: string; // 替代干员
  stage: string; // 所属关卡
  evidence: string; // 弹幕/评论原文引用
  source: "danmaku" | "comment" | "pinned";
  kind: SubstitutionKind;
  likes: number; // 点赞/热度，可信度权重
  verified: boolean; // 干员名字典校验通过
  evidenceUrl?: string; // 评论区溯源链接
}

/** ②b 泛化替代知识（L2）：UP主替换分析图表的条件式知识，不绑定单一关卡 */
export interface GenericSubstitution {
  removed: string; // 可被替换的干员
  replacement: string | null; // 具体替代者；null 表示「可被同类干员替」
  kind: SubstitutionKind;
  conditions: string; // 可替换的情况（环境条件）
  risks: string; // 可能出现的问题
  semantics: string; // 语义注解（如「攻奶不换，部署位置不换」）
  sourceVideo: string; // 来源视频 BV 号
  origin: "chart" | "narration"; // 图表帧 / 解说词
}

/** box 中一个干员的练度（列结构见 docs/notes/recon.md，来自一图流 Excel 导出） */
export interface OperatorEntry {
  name: string;
  owned: boolean;
  rarity: number; // 星级 1-6
  level: number;
  elite: number; // 精英化等级 0-2
  potential?: number; // 潜能等级
  skillLevel?: number; // 通用技能等级
  masteries: number[]; // [1技能, 2技能, 3技能] 专精等级 0-3
  modules?: number[]; // [χ, γ, Δ, α] 分支模组等级
}

/** 用户输入的干员 box */
export interface Box {
  operators: Record<string, OperatorEntry>; // key: 干员名
  source: "excel" | "skland";
}

/** ③ 匹配推荐的输出：最终阵容中的一个槽位 */
export interface RecommendedSlot {
  original: RosterSlot;
  finalOperator: string | null;
  status: "keep" | "substituted" | "unresolved";
  kind?: SubstitutionKind; // 替换类型（keep 时无替换发生）
  via: Substitution | GenericSubstitution | null; // 采用的知识条目
  risk: "low" | "medium" | "high"; // 关键位替换 → high
  evidenceUrl: string; // 评论区溯源链接
  note: string; // 给用户看的说明（如「建议回评论区验证」）
}

/** 单个视频（=单个关卡）的完整分析结果 */
export interface StageResult {
  roster: Roster;
  substitutions: Substitution[];
  recommendations: RecommendedSlot[];
}

/** 管道输出（popup 渲染所需的全量信息） */
export interface AnalysisOutput extends StageResult {
  videoTitle: string;
  stage: string;
  bvid: string;
}
