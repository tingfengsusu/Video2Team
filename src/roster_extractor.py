"""① 阵容提取（复用/改造 Video2Shop 的 video_processor + deepseek 分析）。

优先级（见 docs/design.md §4）：
1. 视频简介 / 置顶评论 —— UP 主通常写明阵容，最可靠；
2. 下载 → 抽帧 → OCR → DeepSeek 多模态 —— 兜底。

同时从解说/简介/置顶评论中标记关键位（is_key），供风险分级用。
"""

from src.models import Roster


def extract_roster(video_url: str, config: dict) -> Roster:
    """从单个攻略视频提取阵容（干员+技能+部署顺序+关键位标记）。"""
    raise NotImplementedError("v0: 先实现简介/置顶评论路径，再接抽帧 OCR 兜底")
