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
    """② 实战替代挖掘的输出：一条「谁可以被谁替」的建议。"""

    removed: str                     # 视频阵容中被替换的干员
    replacement: str                 # 替代干员
    stage: str                       # 所属关卡
    evidence: str                    # 弹幕/评论原文引用
    source: str                      # danmaku | comment | pinned
    likes: int = 0                   # 点赞/热度，可信度权重
    verified: bool = False           # 干员名字典校验通过


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
    via: Substitution | None = None  # 采用的实战建议（substituted 时有值）
    risk: str = "low"                # low | medium | high；关键位替换 → high
    evidence_url: str = ""           # 评论区溯源链接
    note: str = ""                   # 给用户看的说明（如「建议回评论区验证」）


@dataclass
class StageResult:
    """单个视频（=单个关卡）的完整分析结果。"""

    roster: Roster
    substitutions: list[Substitution] = field(default_factory=list)
    recommendations: list[RecommendedSlot] = field(default_factory=list)
