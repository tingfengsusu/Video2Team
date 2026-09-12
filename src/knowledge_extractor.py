"""②b 泛化替代知识提取（L2）：从视频图表帧提取 UP 主整理的替换分析知识。

数据来源是简评/池子分析类视频中的「挂机替换概率/问题」类表格
（干员 × 可替换的情况 × 可能出现的问题），以及攻略视频内的同类图表。

流程：抽帧（复用 video_processor）→ 图表帧检测（表格线/文字密度特征）
     → DeepSeek 多模态提取为 GenericSubstitution 结构 → 干员名字典校验 → 入库。

注意：图表底部的语义注解（如「替换指的是攻奶不换，部署位置不换」）
定义了本表的替换语义边界，必须保留到 semantics 字段。
积累策略：冷启动手动提取知名 UP 视频；运行时分析视频时自动入库（v2 考虑共享库）。
"""

from src.models import GenericSubstitution


def detect_chart_frames(frames: list) -> list:
    """从抽帧结果中检测含结构化表格/图表的帧。返回 [(frame, timestamp)]。"""
    raise NotImplementedError("v1：先按 OCR 文字密度粗筛，再由多模态 LLM 精判")


def extract_generic_knowledge(
    chart_frames: list,
    operator_db,
) -> list[GenericSubstitution]:
    """多模态提取图表中的替代知识，过干员名字典校验后返回结构化条目。"""
    raise NotImplementedError("v1")
