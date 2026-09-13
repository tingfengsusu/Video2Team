# 侦察笔记：B站 API 与数据源（2026-09-13 验证）

## 1. B站接口验证结果 ✅ 全部可用

| 接口 | 端点 | 验证结论 |
|------|------|---------|
| 视频信息 | `GET https://api.bilibili.com/x/web-interface/view?bvid={BV}` | code 0。返回 aid、cid、title、desc（简介）、pubdate、**pages[]（分P列表，每P含 cid + part 标题）** |
| 评论 | `GET https://api.bilibili.com/x/v2/reply?type=1&oid={aid}&sort=1` | code 0，**无需 wbi 签名**。置顶在 `top` 字段（无置顶时为 null）；`replies[]` 含 rpid / like / content.message |
| 弹幕 | `GET https://comment.bilibili.com/{cid}.xml` | 直接返回 XML。`<d p="时间秒,模式,字号,颜色,...">文本</d>`，**每分P独立 cid** |

注意：请求应从插件 background 发出（host_permissions 已配置），携带用户登录态。

## 2. 关键发现：攻略合集存在三种形态

以 BV1q8FaekE9D（【相见欢】OR-EX-8突袭等EX关【摆完挂机】合集，15 分P）为样本：

| 形态 | 弹幕 | 评论 | 路由方案 |
|------|------|------|---------|
| a. 独立视频系列（一关一视频） | 天然隔离 | 天然隔离 | 无需路由（原设计） |
| **b. 多分P单一视频（实测常见！）** | **按分P cid 天然隔离** | **全合集混在一个评论区** | 分P标题（`view.pages[].part`，如「P3 OR-EX-2」）做正则路由 |
| c. 长视频不分P | 混杂 | 混杂 | 时间轴 + AI 识别关卡切换（v2 兜底，不变） |

→ 分析单元修订为「关卡」：独立视频 = 视频即关卡；分P = 分P即关卡。

## 3. 阵容提取的覆盖率提醒

样本 UP 的简介明确写「主要提供打法思路而非固定阵容搭配」，且该视频无置顶评论 → **简介/置顶评论文本路径并非 100% 覆盖**，抽帧 OCR 兜底（可选本地服务）的真实需求比预想高。v0 先做文本路径，无法提取时明确告知用户。

## 4. L1 干员字典：数据源确认 ✅

一图流开源仓库 `Arknights-yituliu/frontend-v2-plus` 的
`src/static/json/operator/character_table_simple.v2.json`：

- 顶层对象，key = charId（如 `char_145_prove`）
- 字段：`name`（干员名）、`profession`（职业）、`subProfessionId`（分支）、`rarity`、`skills[]`（技能名 + 专精材料）、`equip[]`（模块）
- 用途映射：名字典校验（name）+ 属性上下文（profession/branch/rarity）+ 技能名校验（skills[].skillName）
- 同目录 `composite_table.json`（升变/异格关联，如 星熊↔斩业星熊）值得一并利用

## 5. 新挑战：评论使用昵称/黑话缩写

实测评论原文：「借的 **ew** + 玛恩纳 + 余 硬是没打过，坐等单核」——社区大量使用缩写（ew、塞爹、42 等）。

方案：DeepSeek 精筛时**让 LLM 同时把昵称还原为干员全名**，再过字典校验全名（还原错会被字典拦住）。字典本体不建昵称索引，后续如需再补（PRTS 有昵称数据）。

## 6. 待办（需用户配合）

- [ ] 用户提供一图流导出的 Excel 样例 → 确定 `box.ts` 解析规格（前端仓库未直接暴露导出代码，按真实文件写解析器）
- [ ] 用户提供 1-2 个实际在看的攻略视频链接 → v0 端到端测试素材（要求：阵容里有用户没有的干员）
