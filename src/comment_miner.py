"""② 实战替代挖掘：从弹幕/评论区提取「XX 可以用 YY 代替」的映射对。

流程：抓取（B站弹幕 XML / 评论 API）→ 正则粗筛 → LLM 精筛 → 干员名字典校验。
评论区（尤其高赞）权重高于弹幕（见 docs/design.md §9）。
分析单元是单个视频，弹幕/评论天然只讨论该视频对应的关卡，无需路由。
"""

from src.models import Roster, Substitution


def fetch_danmaku(video_id: str) -> list[dict]:
    """拉取弹幕（XML，带时间戳）。返回 [{time, text}]。"""
    raise NotImplementedError


def fetch_comments(video_id: str, max_comments: int = 200) -> list[dict]:
    """拉取评论（B站 评论 API）。返回 [{text, likes, is_pinned, rpid}]。"""
    raise NotImplementedError


def mine_substitutions(
    roster: Roster,
    danmaku: list[dict],
    comments: list[dict],
    operator_db,
) -> list[Substitution]:
    """正则粗筛 + LLM 精筛出「X→Y」映射对，并过干员名字典校验（防幻觉）。"""
    raise NotImplementedError("v0: 仅评论区，置顶+高赞优先")
