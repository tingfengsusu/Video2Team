/**
 * 核心数据模型（设计见 docs/design.md §5）。
 * 分析管道中流动的四类结构 + 替换类型常量。
 */

import type { MergedStagePool } from "./dispatchPool";

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

/** 占用清单（矢量突破类多关派遣活动）：被派遣干员 → 来源关卡标签。
 *  派遣关锁定的干员在推图关不可用，推荐时按「不可用」处理。 */
export type LockedOps = Record<string, string>;

/** ③ 匹配推荐的输出：最终阵容中的一个槽位 */
export interface RecommendedSlot {
  original: RosterSlot;
  finalOperator: string | null;
  status: "keep" | "substituted" | "unresolved";
  kind?: SubstitutionKind; // 替换类型（keep 时无替换发生）
  via: Substitution | GenericSubstitution | null; // 采用的知识条目
  alternatives: Substitution[]; // 该槽位的其余实战建议（substituted = 除主推荐外；unresolved = 全部）
  risk: "low" | "medium" | "high"; // 关键位替换 → high
  evidenceUrl: string; // 评论区溯源链接
  note: string; // 给用户看的说明（如「建议回评论区验证」）
  lockedFrom?: string; // 原干员被派遣占用时的关卡标签（推图关需替换）
}

/** 派遣关编号的识别来源：文本显式码 → 关卡库通名 → 截图网格位置。 */
export type StageResolutionSource = "text_code" | "level_name" | "grid" | "unknown";

/** 截图中的关卡识别提示（由多模态模型仅凭画面证据输出）。 */
export interface StageGridCellHint {
  position?: number; // 直接给出阅读顺序位置时使用
  row?: number; // 完整网格中的行（1-based）
  column?: number; // 完整网格中的列（1-based）
  columns?: number; // 完整网格总列数
  name?: string; // 该格中文通名
}

export interface StageVisionHints {
  explicitCode?: string; // 画面中明确写出的 VEC-SPxx
  gridRows?: number; // 完整网格的总行数（含未选中的白格与灰色禁用格）
  gridColumnsTotal?: number; // 完整网格的总列数（与 gridColumns 同义，模型可能填任一个）
  enabledSupplies?: number; // 画面「当前启用补给 N/M」里的 N，用于与实际识别到的黄格数量对账
  matchedName?: string; // 画面中读到的关卡通名
  gridPosition?: number; // 选择界面网格阅读顺序位置（1-based）
  gridRow?: number; // 网格行（1-based）
  gridColumn?: number; // 网格列（1-based）
  gridColumns?: number; // 网格总列数，用于由行列换算阅读顺序位置
  gridName?: string; // 对应格子里的中文通名
  gridCells?: StageGridCellHint[]; // 黄色/启用格；可一次返回多关
  note?: string;
}

/** 截图中的单个格子按位置推算出的派遣关。 */
export interface StageGridCandidate {
  gridPosition: number;
  gridRow?: number;
  gridColumn?: number;
  gridName?: string;
  displayCode: string;
  stageId: string;
  stageName: string;
  needsVerification?: boolean;
}

/** 一次分析最终采用的派遣关解析结果。 */
export interface StageResolution {
  source: StageResolutionSource;
  displayCode?: string; // VEC-SP07
  stageId?: string; // act3break_sp07
  stageName?: string; // 投资回报
  gridPosition?: number;
  gridName?: string;
  gridCandidates?: StageGridCandidate[]; // 多黄格截图的全部位置映射
  needsVerification?: boolean; // 网格通名与位置推算不一致
  note?: string;
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
  stageCode?: string; // 已解析的显示码，如 VEC-SP07
  stageName?: string; // 已解析的关卡通名
  stageResolution?: StageResolution;
  dispatchGuides?: MergedStagePool[]; // P1 黄色格对应的派遣关攻略（MAA + B站）
  dispatchGuideNote?: string; // P1 识别成功但攻略查询失败时的降级说明
  /** 每关的识别依据（显示码 → 「P1 网格第 5 格，格内读到「催化装备」」）：识别错了可见可纠 */
  dispatchGuideEvidence?: Record<string, string>;
  /** 本活动全部派遣关（显示码 + 关名）：供结果区「＋ 补一个关…」下拉补漏识别的关 */
  dispatchStageOptions?: { displayCode: string; stageName: string }[];
  /** 关卡链（第十一轮 q4）：依赖关 → 它的前置关，如 VEC-SP10 → VEC-SP09（前置关已自动纳入候选池） */
  dispatchStageChain?: Record<string, string>;
  stats?: {
    danmakuTotal: number; // 抓取到的弹幕总数（XML 接口返回）
    commentCandidates: number; // 进入候选池的评论数
    danmakuCandidates: number; // 进入候选池的弹幕数（正则命中）
    unknownNames?: string[]; // 本次分析中字典无法识别的称呼（已记入昵称纠错）
  };
}

/** 后台分析任务状态（持久化到 storage.session，popup 重开可恢复） */
export interface TaskState {
  // web_paste = 网页版模式：提示词已注入 DeepSeek 网页端，等待用户发送并回贴最终回复
  status: "running" | "web_paste" | "done" | "error";
  startedAt: number;
  bvid: string;
  page: number; // 独立视频统一为 0
  stage?: string;
  progress?: string; // 当前阶段文案
  result?: AnalysisOutput;
  error?: string;
}
