"""主管道：编排 ①阵容提取 → ②实战替代挖掘 → ③匹配推荐 → 输出（docs/design.md §4）。"""

from src.models import Box, StageResult


def analyze_video(video_url: str, box: Box, config: dict) -> StageResult:
    """分析单个攻略视频（分析单元 = 单个视频，见 docs/design.md §3.1）。"""
    raise NotImplementedError


def analyze_collection(collection_url: str, box: Box, config: dict) -> list[StageResult]:
    """遍历合集（系列）中的每个视频，按关卡汇总。"""
    raise NotImplementedError("v1")
