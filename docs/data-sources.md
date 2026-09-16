# 数据来源与致谢

Video2Team 自身**不生产任何数据**：干员信息、昵称黑话、替代建议，全部来自社区。本页说明各数据的确切来源、更新方式与用途边界，并向上游致谢。

---

## 1. 干员字典 `data/operators.json`

| 项 | 说明 |
|---|---|
| 来源 | [Arknights-yituliu/frontend-v2-plus](https://github.com/Arknights-yituliu/frontend-v2-plus) 的 `src/static/json/operator/character_table_simple.v2.json` —— 明日方舟「一图流」的开源前端仓库 |
| 本项目处理 | 字段裁剪为 `name / profession / branch / rarity / skills`，作为**打包快照**（离线兜底） |
| 运行时获取 | 在线优先：jsDelivr → raw GitHub → 打包副本，24 小时缓存；新干员上线后用户**无需升级插件**即可自动获得 |
| 用途边界 | 仅做干员名校验（防 AI 幻觉）与属性上下文，**不参与推荐** |

## 2. 昵称 / 黑话对照表 `data/aliases.json`

| 项 | 说明 |
|---|---|
| 主体来源 | [Li-shi-ling/astrbot_plugin_mrfzccl](https://github.com/Li-shi-ling/astrbot_plugin_mrfzccl)（明日方舟「猜猜乐」机器人插件）的 `arknights_operator_aliases.json` —— 170 干员 / 354 个昵称（该仓库许可 AGPL-3.0） |
| 合并规则 | 剔除「一名多指」的歧义昵称（如「剑圣」「猫猫」）；叠加本项目的少量人工条目 |
| 运行时加载 | 三层：内置快照 → 在线（上游社区数据 + 本仓库精选，24h 缓存）→ **用户本地对照**（设置页「昵称纠错」确认，优先级最高） |
| 社区回传 | 用户积累的对照可自愿提交（预填 Issue / 复制），并入本仓库后供所有用户共享 |

## 3. 实时数据（仅当次分析使用，不落盘）

| 数据 | 来源 | 处理方式 |
|---|---|---|
| 视频信息 / 弹幕 / 评论 | B站公开接口 | 经用户浏览器实时获取，仅用于当次分析 |
| 干员练度表 | 用户从「一图流」导出的 Excel | 纯本地解析（SheetJS），**不上传** |
| B站账号状态 | 用户浏览器本身 | 插件**不读取、不存储**任何账号凭证 |

## 4. 版权声明

角色名称与游戏内容版权归 **鹰角网络（Hypergryph）** 所有。本项目为社区爱好者开发的开源工具，完全非商业，与鹰角网络无任何关联。如相关方对数据使用有异议，请提 Issue，我们会及时调整或移除。

---

## 致谢

- 感谢 **[一图流](https://ark.yituliu.cn/)（Arknights-yituliu）** 团队与各位贡献者——干员字典的数据完全来自你们长期维护的开源仓库；
- 感谢 **[猜猜乐插件](https://github.com/Li-shi-ling/astrbot_plugin_mrfzccl)** 的作者 Li-shi-ling 与社区整理者——300 多条昵称/黑话对照是「老玛」「大姨」「火陈」能被看懂的原因；
- 感谢**每一位在弹幕和评论区分享替代方案的玩家**——这个工具什么都不发明，只是让你们的实战经验更容易被找到；
- 感谢 [DeepSeek](https://www.deepseek.com/)、[esbuild](https://esbuild.github.io/)、[SheetJS](https://sheetjs.com/) 等开源项目与服务，本工具建立在其之上。

> 如果你发现这里的来源标注有遗漏或不当之处，欢迎提 Issue 指正。
