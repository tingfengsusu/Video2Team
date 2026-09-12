"""核心数据模型（设计见 docs/design.md §5）。"""

from dataclasses import dataclass, field


@dataclass
class RosterSlot:
    """原阵容中的一个槽位。"""

    operator: str                    # 干员名（须过 operator_db 校验）
    skill: int | None = None         # 技能编号
    mastery: int | None = None       # 专精等级
    deploy_order: int | None = None  # 部署顺序
    is_key: bool = False             # 关键位标记
    key_reason: str = ""             # 关键原因（来自解说/简介/置顶评论）


@dataclass
class Roster:
    """① 阵容提取的输出：单个视频对应的关卡阵容。"""

    stage: str                       # 关卡名，如 "EX-8"
    video_id: str                    # 来源视频 BV 号
    slots: list[RosterSlot] = field(default_factory=list)
    source: str = ""                 # description | pinned_comment | ocr_llm


@dataclass
class Substitution:
    """②a 实战替代挖掘的输出（L3）：一条「谁可以被谁替」的关卡绑定建议。"""

    removed: str                     # 视频阵容中被替换的干员
    replacement: str                 # 替代干员
    stage: str                       # 所属关卡
    evidence: str                    # 弹幕/评论原文引用
    source: str                      # danmaku | comment | pinned
    kind: str = "operator_swap"      # 替换类型，见 KIND_* 常量
    likes: int = 0                   # 点赞/热度，可信度权重
    verified: bool = False           # 干员名字典校验通过


# 替换类型（L2 图表底部的语义注解表明替代是多粒度的）
KIND_OPERATOR_SWAP = "operator_swap"   # 换干员（默认）
KIND_SKILL_SWAP = "skill_swap"         # 换技能/攻速
KIND_POSITION_SWAP = "position_swap"   # 换部署位置
KIND_MANUAL = "manual"                 # 该格放弃挂机，改手动操作


@dataclass
class GenericSubstitution:
    """②b 泛化替代知识（L2）：UP主替换分析图表的条件式知识，不绑定单一关卡。"""

    removed: str                     # 可被替换的干员
    replacement: str | None = None   # 具体替代者；None 表示「可被同类干员替」
    kind: str = KIND_OPERATOR_SWAP   # 替换类型
    conditions: str = ""             # 可替换的情况（环境条件）
    risks: str = ""                  # 可能出现的问题
    semantics: str = ""              # 语义注解（如「攻奶不换，部署位置不换」）
    source_video: str = ""           # 来源视频 BV 号
    origin: str = "chart"            # chart | narration（图表帧 / 解说词）


@dataclass
class OperatorEntry:
    """box 中一个干员的练度。"""

    name: str
    elite: int = 0                   # 精英化
    level: int = 1
    masteries: list[int] = field(default_factory=list)  # 各技能专精


@dataclass
class Box:
    """用户输入的干员 box。"""

    operators: dict[str, OperatorEntry] = field(default_factory=dict)  # key: 干员名
    source: str = ""                 # excel | skland

    def has(self, name: str) -> bool:
        return name in self.operators


@dataclass
class RecommendedSlot:
    """③ 匹配推荐的输出：最终阵容中的一个槽位。"""

    original: RosterSlot
    final_operator: str | None = None
    status: str = "keep"             # keep | substituted | unresolved
    kind: str = KIND_OPERATOR_SWAP   # 替换类型
    via: Substitution | GenericSubstitution | None = None  # 采用的知识条目
    risk: str = "low"                # low | medium | high；关键位替换 → high
    evidence_url: str = ""           # 评论区溯源链接
    note: str = ""                   # 给用户看的说明（如「建议回评论区验证」）


@dataclass
class StageResult:
    """单个视频（=单个关卡）的完整分析结果。"""

    roster: Roster
    substitutions: list[Substitution] = field(default_factory=list)
    recommendations: list[RecommendedSlot] = field(default_factory=list)
