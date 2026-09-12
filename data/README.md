# data/ 目录说明

- `operators.json`（待添加）：干员基础数据（名字典 + 属性上下文），来源候选：
  - PRTS wiki 干员数据
  - 一图流开源数据（GitHub: yituliu）
  - 两者合并
- **用途边界**（见 docs/design.md §3.3）：只做干员名校验（防 LLM 幻觉）和给 LLM 供属性上下文，**不参与替代推荐**。
- `cache/`（gitignored）：弹幕/评论/视频等抓取缓存。
