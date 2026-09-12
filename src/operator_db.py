"""干员知识库：名字典 + 属性上下文（见 docs/design.md §3.3）。

只干两件杂活，不参与推荐：
1. exists() —— 校验 AI 提取的干员名是否真实存在（防 LLM 幻觉）；
2. get()    —— 给 LLM 推断替代时供属性上下文（职业/分支/费用/机制标签）。

数据：data/operators.json（来源 PRTS / 一图流开源数据，待定，见 docs/design.md §10）。
"""

from src.models import OperatorEntry


class OperatorDB:
    def __init__(self, json_path: str):
        self._by_name: dict[str, dict] = {}
        raise NotImplementedError("加载 data/operators.json，建立 干员名 → 属性 索引")

    def exists(self, name: str) -> bool:
        return name in self._by_name

    def get(self, name: str) -> dict | None:
        """返回干员属性上下文（职业/分支/费用/机制标签），供 LLM 推断用。"""
        return self._by_name.get(name)

    def to_entry(self, name: str) -> OperatorEntry | None:
        raise NotImplementedError
