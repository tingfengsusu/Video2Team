# data/ 目录说明

> 各文件的确切来源、更新方式与致谢详见 [data-sources.md](data-sources.md)。

- `operators.json`（待添加）：干员基础数据（名字典 + 属性上下文）。来源已定：一图流开源仓库
  `Arknights-yituliu/frontend-v2-plus` 的 `src/static/json/operator/character_table_simple.v2.json`
  （字段已侦察确认，见 docs/notes/recon.md）。
- `aliases.json`：**纠错集**——昵称/黑话 → 干员全名对照。LLM 提取时注入 prompt 作参照；
  运行时无法还原的称呼记入 `corrections_pending.json`，人工确认后并入本表。
- **用途边界**（见 docs/design.md §3.3）：字典与纠错集只做干员名校验（防 LLM 幻觉）和给 LLM 供属性上下文，**不参与替代推荐**。
- `cache/`（gitignored）：弹幕/评论等抓取缓存。
