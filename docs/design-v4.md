# Video2Team 设计方案 v4 — 下一阶段实现交接文档

> 本文档汇总 2026-10-08 设计会话的全部结论，供新对话直接开始实现。
> 每项含：设计结论 / 实测依据 / 涉及改动 / 验收标准。

---

## 🚀 新会话启动指令（第一件事，直接复制粘贴）

```
这是 Video2Team 项目的延续会话（Chrome 扩展：B站明日方舟攻略 → 阵容适配）。
先读 docs/design-v4.md（重点：顶部启动指令、§0 仓库状态、§8 实现顺序），
然后按 §8 的顺序逐项实现。

第一步：git stash list 确认 stash@{0} 是「矢量突破派遣占用功能-实现暂存」
→ git stash pop 恢复 → 补齐 popup/index.html 缺失的占用清单区块
（#locks / #lockCount / #lockClear）→ npx tsc --noEmit && npm run build 通过后提交。

之后依次实现 §2（MAA作业数据源）、§6（结果缓存+错位修复）、§3（B站三级挖掘）、
§5（反馈直达B站私信）、§4（别名编辑器）、§7（点赞致谢）。
每项完成后按文档中该节的「验收标准」自测。
```

---

## 0. 仓库状态与注意事项

- 仓库：`D:\Code\Video2Team`（GitHub: tingfengsusu/Video2Team，分支 main，本文档已推送）
- **stash@{0} 已冻结一项完整实现**：「矢量突破派遣占用功能-实现暂存」（见 §1）
- 构建命令：`npm run build`（esbuild，秒级）｜类型检查：`npx tsc --noEmit`
- 共享工作区注意：另有会话可能同时编辑本仓库，动手前先 `git status` + `git pull`；编辑 core 文件（如 content/index.ts、background/index.ts）前先 `Read` 再改，避免撞车

---

## 1. 派遣占用清单（🔒 锁定感知推荐）——**实现已完成，在 stash@{0}**

### 设计结论
矢量突破类活动：派遣关锁定的干员在推图关不可用。新增「占用清单」`LockedOps = { 干员名 → 来源关卡标签 }`，
存 `chrome.storage.local.lockedOps`。推荐引擎可用性 = `在box ∧ 不在占用清单`。

### 已实现内容（stash 内）
- `types.ts`：`LockedOps` 类型 + `RecommendedSlot.lockedFrom`
- `recommender.ts`：keep 判定加锁定维度；替代者优先未占用；冲突提示与风险升级
- `render.ts`：干员名 🔒 徽章（title 提示锁在哪关）+ `renderLockedSection()` chips 区块
- `background/index.ts`：`getLockedOps()` 读取并传入 recommend
- `content/index.ts`：面板「🔒 占用清单」区 + 结果下方「➕ 本关阵容加入占用清单」按钮 + chips 增删/清空 + storage 同步
- `popup/main.ts`：同上逻辑已接入

### 恢复后需补齐的尾巴
- `popup/index.html` **尚未添加**清单区块锚点（`#locks` / `#lockCount` / `#lockClear`），参照 content 面板结构补上
- 构建 + 提交（stash 内容未提交过任何一次）

### 验收标准
- 分析某关后点「加入占用清单」→ chips 出现「干员 · 关卡名」
- 再分析含该干员的推图关 → 该槽位不再「保留」，note 显示「原干员已用于派遣（关X）」；替代者优先未占用者
- 两个入口（视频页面板 / popup）清单互通；✕ 移除、清除全部生效

---

## 2. MAA 作业站数据源（派遣关信息的**第一数据源**，已全实测）

### 实测记录（2026-10-08，匿名可用）
| 接口 | 说明 |
|------|------|
| `GET https://prts.maa.plus/arknights/level` | 3500 条关卡库：`{cat_three:"VEC-SP07", stage_id:"act3break_sp07", name:"投资回报", cat_two:"矢量突破"}` |
| `GET https://prts.maa.plus/copilot/query?levelKeyword={码}&page={n}&limit={m}&orderBy=hot_score&desc=true` | 作业列表；**每条 `content` 字段内嵌完整作业 JSON** |
| 查询参数全集（自前端 SDK 提取） | `levelKeyword`（按内部码，支持前缀）、`operator`（按干员反查）、`content`、`document`、`uploaderId`、`orderBy`、`desc`、`language`、`page`、`limit` |

**作业 JSON 结构**（`JSON.parse(item.content)`）：
```json
{"minimum_required":"v6.0.0","stage_name":"act3break_sp07",
 "doc":{"title":"...","details":"...可借助战"},
 "opers":[{"name":"焰狐龙梓兰","skill":3,"skill_usage":0},{"name":"塞雷娅","skill":1}]}
```
- **opers 是游戏标准全名**（圣聆初雪/斩业星熊/予愿安洁莉娜）→ 零别名还原、零 OCR、零幻觉
- 前缀查询实测：`levelKeyword=act3break_sp` → 160 条 = 该活动**全部派遣关**一次拿全
- `prts.plus` = ZOOT-Plus（MAA 作业站），前后端开源：`ZOOT-Plus/zoot-plus-frontend` + `ZootPlusBackend`

### 实测坑（实现时必须处理）
**内部码与显示码不是数字对应**，不可推算，必须查关卡库：
- 实测 `VEC-SP06 ↔ act3break_sp10`（林间小憩）；作业 doc.title 里的显示码为作者手写，仅作展示
- 映射规则：以关卡库 `cat_three ↔ stage_id` 为准；活动前缀（如 `act3break`）可从推图关合集的任一关口映射得到

### 实现设计
- 新模块 `src/shared/maa.ts`：
  - `getLevelDb()`：拉关卡库，存 `chrome.storage.local` 缓存（24h TTL）
  - `queryCopilots(levelKeyword, opts)`：查询 + 解析 `content` → `{stageId, displayCode, stageName, opers[], details, id}`
  - `resolveEventPrefix(displayCode)`：显示码 → 内部码 → 取前缀（去掉 `_spXX`/`_XX` 后缀）
- `manifest.json` 增加 `host_permissions: "https://prts.maa.plus/*"`
- 结果进「派遣候选池」的数据结构：`{displayCode, stageName, schemes: [{opers, skill, details, copilotId, uploader}]}`

### 验收标准
- 输入 VEC-SP07 → 返回该关的候选方案列表，每方案含标准干员名（与 box 名可直接比较，无别名问题）
- 一次 `act3break_sp` 前缀查询产出全部派遣关的候选池
- 无网络/接口异常时静默降级到 §3 的 B站挖掘路径

---

## 3. B站三级挖掘（补充数据源：实战视频与新打法）

### 设计结论
用于补充 MAA 源没有的视频实战内容（新干员单核、低配打法）。三级渐进：

| 层级 | 数据 | 成本 | 实测 |
|------|------|------|------|
| ① 搜索主标题 | `x/web-interface/wbi/search/type?search_type=video&keyword=VEC-SP07&page=N`（wbi 签名，已实现） | 1-3 页请求 | 实测 code 0，50 页/1000 条；标题含干员名与「单人解/低星」难度标签 |
| ② 命中合集的分P标题 | `view` API 的 `pages[].part` | 每合集 1 请求 | 实测 BV1mHpF6qEqF：19 个分P标题全是「VEC-SP05 令」「VEC-SP07 凯尔希」式「关卡+干员」对 |
| ③ 简介补充 | `view` API 的 `desc` | 每视频 1 请求（触发式） | 部分攻略只有简介写干员；触发条件：某关候选池 < 3 方案时对 top5-10 结果拉简介 |

- 标题去 `<em>` 高亮标签后与分P/简介一起送 **1 次 LLM 调用**提取 `{operators[], mode: 单人/双人/低星/挂机, bvid}`
- 干员名过字典 + 纠错集（「42」→史尔特尔、「安杰」→安洁莉娜、「妈妈」→电弧 均已在册）
- 结果按关卡聚合成候选池，与 §2 的 MAA 池合并展示（MAA 源标记「结构化」、B站源标记「实战视频」）

### 验收标准
- 搜索 VEC-SP07 → 候选池含「凯尔希单人」「泥岩单人」「阿米娅+蛇屠箱」等方案
- 候选池合并展示无重复干员方案错乱；标题空心（无干员）不产生幻觉条目

---

## 4. 别名纠错集网页编辑器（GitHub Pages）

### 现状（已实现，无需重做）
`src/shared/aliases.ts` 三层加载已上线：① 打包快照 → ② 远程（猜猜乐上游 + 本仓库 `data/aliases.json` 经 jsDelivr/raw）→ ③ 本地用户对照（最高优先级）。
设置页已有「昵称纠错」：未识别称呼自动积累 `corrections_pending` → 确认后本地生效 → 可预填 GitHub Issue 提交。
**合入仓库 `data/aliases.json` 后，所有用户 24h TTL 内自动同步** —— 社区闭环已通，差的只是"好用的查看/编辑界面"。

### 设计
- **GitHub Pages 单文件编辑器**：`docs/alias-editor/index.html`（纯静态零后端）
  - 加载 `data/aliases.json` → 表格视图（搜索 / 排序 / 增删改）
  - **歧义冲突检测**：同昵称指向多干员时红标（逻辑与 `invertUpstream` 相同）
  - 两个出口：①「复制 JSON + 打开 GitHub 编辑页」→ 粘贴提 PR；② 进阶：GitHub Device Flow OAuth 直接提 PR（纯前端可行，无服务器）
  - **导入插件的本地积累**：支持粘贴 `corrections_pending` 导出内容（设置页新增「导出错题本」按钮）
- 仓库 Settings → Pages 指向 `docs/`

### 验收标准
- 网页可搜索/编辑别名、检出歧义；复制内容粘贴到 GitHub 编辑页可成功提 PR

---

## 5. 反馈机制：直达作者的 B站私信（修订版，不走 GitHub 为主）

### 设计结论
核心出口 = **复制反馈内容 + 跳转作者私信页**（`https://message.bilibili.com/#/whisper/mid{作者UID}`），
用户在B站粘贴发送。契合B站用户群（不一定有 GitHub）。

### 表单（设置页 + 面板底部入口）
```
反馈类型：[问题/Bug] [功能建议] [数据源反馈] [其他]
问题描述：[文本框]
────────────────────────────
☑ 用我的B站昵称署名（只读取昵称/UID，不上传任何登录凭证）
  自动诊断信息（预览可编辑）：
  · 插件版本 ｜ AI 模式 ｜ box 人数
  · 当前页面：BV号 + 分P（非视频页则不带）
  · 最近一次错误：task.error（如有）
────────────
[📋 复制并打开我的B站私信]  ← 主按钮（复制全文 + open message.bilibili.com/#/whisper/mid{UID}）
[复制到剪贴板]             ← 兜底
[GitHub Issue 预填]        ← 备用出口（保留）
```

### 实现要点
- ⚠️ **待办（作者填入）**：`src/shared/constants.ts` 新建并写入
  `export const FEEDBACK_MID = "";  // TODO: 填入你的B站UID（纯数字）`
  UID 获取方式：打开自己的B站个人空间，URL `space.bilibili.com/12345678` 里的数字即 UID。
  **未填入时**：主按钮降级为仅「复制到剪贴板」并提示"作者私信直达未配置"。
- B站账号信息：`/x/web-interface/nav`（页面代理通道）→ 只取 `uname`/`uid`；`isLogin:false` 则不显示署名勾选
- 隐私边界写入 UI 文案：绝不上传 Cookie / 凭证 / 练度表内容

### 验收标准
- 点主按钮 → 剪贴板包含完整反馈文本 + 新标签打开作者私信页
- 未登录B站时无署名行且提示正常

---

## 6. 结果缓存 + 多页面错位修复（体验硬伤）

### 问题根因（现实现）
`task` 是 `storage.session` 的单键全局状态：任何页面打开 popup/面板都显示「最近一次任务」→ B 页面看到 A 的结果；且结果不持久。

### 设计
**缓存模型（分P细分）**：
```
storage.local.resultCache = {
  "BV1mHpF6qEqF:1": { ts, result, videoTitle },   // key = bvid:page（独立视频 page=0）
  ...
}
```
- 上限 30 条 LRU + 7 天过期；设置页加「清空分析缓存」
- 写入：分析 done 时由 background 写（它掌握 bvid/page）
- 读取：popup/面板打开 → 解析当前页 `bvid+page` → 命中则渲染 + 灰字提示「上次分析：MM-DD HH:MM ｜ [重新分析]」；未命中则空状态引导

**错位修复**：`TaskState` 增加 `bvid` + `page` 字段；popup/面板只在 `task.bvid/page == 当前页` 时显示「分析中/待粘贴/错误」；不匹配则静默（A 页任务照常后台跑完并写入缓存）。

### 验收标准
- A 页分析 → 切 B 页打开插件 = B 的空状态（不显示 A 结果）；回 A 页 = 上次结果秒出（无重跑）
- 同一 BV 切分P：各分P结果独立（缓存 key 各自命中）
- 多标签并行分析互不串台

---

## 7. 点赞感谢 UP 主（社区正循环）

### 设计
- 触发：采纳某方案（占用清单/推荐结果关联了来源 bvid）→ 展示来源卡片（UP主/标题）→「👍 点赞感谢」按钮 → **用户点击后**执行
- 技术：`POST https://api.bilibili.com/x/web-interface/archive/like`，body: `bvid` + `csrf`（从页面 cookie 读 `bili_jct`）——扩展 content 代理的 POST 版（现有 `BILI_FETCH` 消息扩一个 method/body 参数）
- 边界（外向写操作）：仅用户主动点击、绝不自动；同 bvid 去重（已感谢列表持久化 storage.local）；每次分析最多一次；失败静默提示

### 验收标准
- 已采纳的方案旁出现来源与致谢按钮；点击后按钮变「已感谢 👍」；重复点击不重复请求

---

## 8. 实现顺序建议 + 总验收

| 顺序 | 项目 | 理由 |
|------|------|------|
| 1 | §1 恢复 stash 补尾巴提交 | 已 90% 完成，先落地不浪费 |
| 2 | §6 结果缓存 + 错位修复 | 修用户体验硬伤，改动集中在 task/popup/content |
| 3 | §2 MAA 数据源 | 派遣功能的"精确数据"内核，独立新模块 |
| 4 | §3 B站三级挖掘 | 在 §2 之上做候选池合并展示 |
| 5 | §5 反馈到B站私信 | 小而独立，收社区反馈通道 |
| 6 | §4 别名编辑器 | 纯静态页，独立 |
| 7 | §7 点赞感谢 | 依赖 §2/§3 的来源数据，最后收尾 |

**阶段总验收**：打开推图关合集视频 → 自动发现派遣关清单 → MAA 源一次拉全候选方案 → 用户每关选定 → 占用清单成型
→ 推图关截图两张（补给 + 阵容）→ 输出避开占用的适配阵容 + 冲突提示 → 对采纳来源一键致谢。

---

## 变更记录

- **v4.1（2026-10-08）**：启动指令提至文档顶部（复制即用）；§5 FEEDBACK_MID 待办醒目标注（含未配置时的降级行为）；设计文档已推送 origin/main（截至 `720a69b`）。
- **v4.0（2026-10-08）**：七项设计汇总成文（派遣占用 / MAA数据源 / 三级挖掘 / 别名编辑器 / 反馈私信 / 结果缓存 / 点赞致谢）。
