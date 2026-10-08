# Video2Team 设计方案 v4 — 下一阶段实现交接文档

> 本文档汇总 2026-10-08 设计会话的全部结论，供新对话直接开始实现。
> 每项含：设计结论 / 实测依据 / 涉及改动 / 验收标准。

---

## 🚀 新会话启动指令（第一件事，直接复制粘贴）

```
这是 Video2Team 项目的延续会话（Chrome 扩展：B站明日方舟攻略 → 阵容适配）。
先读 docs/design-v4.md（重点：顶部指令、§0 状态、§9 修复清单、§8 顺序）。

当前进度：v4 六项 + v4.2 两项缺陷修复 + v4.3 §9 修复清单（7 项）已全部实现并验证。
v4.3 覆盖内容（见 §9，全部 ✅）：
① 数据源标签改名（结构化→MAA作业 / 实战→B站视频）② 候选池可点击链接（来源页 + 关卡标题）
③ 候选方案勾选 → 占用实时置灰（勾选即写 lockedOps，结果区变灰+删除线+🔒，无需重新分析）
④ 空清单引导文案 ⑤ 干员名修饰词清洗（高练机械师→机械师，不进待确认队列）
⑥ 网格通名 OCR 聚焦黄格内名称区 ⑦ GitHub Pages 编辑器已开通

回归自测：npm run selftest:v43（v4.3）｜selftest:stage（v4.2）｜selftest:maa / bili / feedback（§2/§3/§5）
类型与构建：npx tsc --noEmit && npm run build

下一批（尚未实现）：§7 点赞感谢 UP 主（依赖 §2/§3 来源数据，最后收尾）；
另 §1 的「候选池勾选」已是占用清单主路径，可考虑把「➕ 本关阵容加入占用清单」按钮在候选池存在时弱化。
```

---

## 0. 仓库状态与注意事项

- 仓库：`D:\Code\Video2Team`（GitHub: tingfengsusu/Video2Team，分支 main，本文档已推送）
- **进度（2026-10-08 晚）**：v4 七项已实现六项并合并（`1949db8` 占用清单 → `4a0d2fe` 结果缓存 → `172a965` MAA 源 → `09c77e2` B站三级挖掘 → `189f7a9` 反馈私信 → `6164c6f` 别名编辑器）；stash 已清空；§7 点赞致谢未实现
- **v4.2 两项缺陷修复：✅ 已完成**（目标关/派遣关分流 + 派遣关网格编号识别，`5a18a7e`/`938fa9b`）
- **v4.3 §9 修复清单：✅ 已全部实现**（标签改名 / 可点击链接 / 勾选实时置灰 / 空清单引导 / 修饰词清洗 / 网格通名 OCR 聚焦）
- 回归自测脚本：`npm run selftest:v43`（v4.3，新增）、`selftest:stage`（v4.2）、`selftest:maa`、`selftest:bili`、`selftest:feedback`
- 构建命令：`npm run build`（esbuild，秒级）｜类型检查：`npx tsc --noEmit`
- 共享工作区注意：另有会话可能同时编辑本仓库，动手前先 `git status` + `git pull`；编辑 core 文件（如 content/index.ts、background/index.ts）前先 `Read` 再改，避免撞车

---

## 1. 派遣占用清单（🔒 锁定感知推荐）——**✅ 已实现（`1949db8`）**

### 设计结论
矢量突破类活动：派遣关锁定的干员在推图关不可用。新增「占用清单」`LockedOps = { 干员名 → 来源关卡标签 }`，
存 `chrome.storage.local.lockedOps`。推荐引擎可用性 = `在box ∧ 不在占用清单`。
（v4.3 起：**候选池勾选**是写入占用清单的主路径，见 §9.3；结果区被占干员显示灰+删除线+🔒。）

### 已实现内容
- `types.ts`：`LockedOps` 类型 + `RecommendedSlot.lockedFrom`
- `recommender.ts`：keep 判定加锁定维度；替代者优先未占用；冲突提示与风险升级
- `render.ts`：干员名占用样式（灰+删除线+🔒，title 提示锁在哪关）+ `renderLockedSection()` chips 区块
- `background/index.ts`：`getLockedOps()` 读取并传入 recommend
- `content/index.ts`：面板「🔒 占用清单」区 + 结果下方「➕ 本关阵容加入占用清单」按钮（手动兜底）+ chips 增删/清空 + storage 同步
- `popup/main.ts` + `popup/index.html`：同上逻辑与清单锚点（`#locks` / `#lockCount` / `#lockClear`）均已接入

### 验收标准
- 分析某关后点「加入占用清单」→ chips 出现「干员 · 关卡名」
- 再分析含该干员的推图关 → 该槽位不再「保留」，note 显示「原干员已用于派遣（关X）」；替代者优先未占用者
- 两个入口（视频页面板 / popup）清单互通；✕ 移除、清除全部生效

### ⚠️ 实测缺陷修复（v4.2，2026-10-08 用户实测反馈，**✅ 已实现**：`5a18a7e` / `938fa9b`）

**缺陷 1：目标关分析被当成派遣关**

现状：`showResult`（content/index.ts 与 popup/main.ts）**无条件**挂「➕ 本关阵容加入占用清单」按钮——
分析推图关（如【全力以赴】VEC-C）也提示加入占用清单，语义错误（推图关的阵容不该被锁进清单）。

修复设计——**关卡类型分流**：

| 关卡类型 | 判定规则（按 stage/视频标题匹配，大小写不敏感） | 结果 UI |
|---------|---------------------------------------------|---------|
| 派遣关 | 含 `VEC-SP` / 特别战线 / 驻防 | 标题「派遣关 · 候选方案」+ **主按钮「➕ 加入占用清单」** |
| 目标关 | 含 核心突破 / `VEC-[A-D]` / 全力以赴 / 其他常规活动关 | 标题「适配结果（含占用约束）」+ **不显示加入按钮**，改为提示「本关为推进关：结果已避开占用清单中的干员」 |
| 无法判断 | 以上都不匹配 | 默认按目标关处理；结果顶部提供小链接「这其实是派遣关 → 当作派遣关」手动切换（点击后记住该 stage 的分类，存 storage.local） |

**缺陷 2：派遣关编号无法识别（特别战线网格规则）**

现状：部分攻略视频/分P 未写明 `VEC-SPxx`，插件无法确定是哪个派遣关。

用户提供的游戏内规则：**特别战线各关共享前缀 `vec-sp-0xx`，编号由选择界面的网格位置决定——从上到下、从左到右依次为 01、02、03 …**（游戏界面本身不显示编号）。

识别优先级设计（从省事到兜底）：

1. **文本显式码**：视频标题 / 分P标题 / 简介中出现 `VEC-SP0X` → 直接采用（现有三级挖掘已覆盖）；
2. **通名匹配**：文本中出现关卡通名（如「荒废矿道」）→ 查 MAA 关卡库 `name` 字段反查显示码（`getLevelDb()` 已有该字段，映射逻辑现成）；
3. **截图网格位置推算**（新增）：用户对「特别战线选择界面」截图 → 视觉定位网格行列布局 → 按「从上到下、从左到右」推算各格编号 → 用 OCR 得到的格内通名与关卡库交叉校验（名称应与推算编号对应；不一致时以位置规则为准并提示用户核实）。

**修复验收**：
- 分析【全力以赴】VEC-C → 无「加入占用清单」按钮，显示目标关提示文案；
- 分析派遣关（标题含 VEC-SP，或无码但通名可匹配）→ 正确归类为派遣关、按钮可用；
- 特别战线网格截图 → 各格编号与关卡库通名一致（抽 3 关核对）。

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
- 结果按关卡聚合成候选池，与 §2 的 MAA 池合并展示（MAA 源标记「**MAA作业**」、B站源标记「**B站视频**」，v4.3 §9.1 改名）

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

| 顺序 | 项目 | 状态 / 理由 |
|------|------|------|
| **0** | **§1「实测缺陷修复」两项** | ✅ 已完成（`5a18a7e`/`938fa9b`）：目标关/派遣关分流 + 派遣关网格编号识别 |
| **0.5** | **§9 v4.3 修复清单（7 项）** | ✅ 已完成（见 §9）：标签改名 / 可点击链接 / 勾选实时置灰 / 空清单引导 / 修饰词清洗 / 网格通名 OCR 聚焦 |
| 1 | §1 占用清单 | ✅ 已完成（`1949db8`） |
| 2 | §6 结果缓存 + 错位修复 | ✅ 已完成（`4a0d2fe`） |
| 3 | §2 MAA 数据源 | ✅ 已完成（`172a965`） |
| 4 | §3 B站三级挖掘 | ✅ 已完成（`09c77e2`） |
| 5 | §5 反馈到B站私信 | ✅ 已完成（`189f7a9`；FEEDBACK_MID 待作者填入） |
| 6 | §4 别名编辑器 | ✅ 已完成（`6164c6f`） |
| 7 | §7 点赞感谢 | 未实现（依赖 §2/§3 的来源数据，最后收尾） |

**阶段总验收**：打开推图关合集视频 → 自动发现派遣关清单 → MAA 源一次拉全候选方案 → 用户每关选定 → 占用清单成型
→ 推图关截图两张（补给 + 阵容）→ 输出避开占用的适配阵容 + 冲突提示 → 对采纳来源一键致谢。

---

## 9. v4.3 修复清单（第二轮实测反馈，2026-10-08 晚，**✅ 已全部实现**）

> 实现于 2026-10-08 晚（本文件同批提交）；离线验收脚本 `npm run selftest:v43`（52 项全通过），
> 另跑通 `selftest:stage`（v4.2）、`selftest:maa`、`selftest:bili`、`selftest:feedback`。

### 9.1 数据源标签改名（「结构化」易混淆）✅
现状：候选方案前缀显示「结构化 5 ｜ 实战 0」。原设计含义：**结构化 = MAA 作业站机器可读作业**、**实战 = B站视频挖掘**。
用户反馈该词不明所以。修复：改为「**MAA作业**」「**B站视频**」（保留计数），并在计数处加 title 提示（"MAA 作业站的结构化方案" / "B站攻略视频挖掘"）。
实现：`dispatchPool.ts` 的 `SOURCE_LABELS` / `SOURCE_TIPS` 统一标签与提示文案；`fromMaa`/`fromBili` 与计数行共用。

### 9.2 候选池可点击链接 ✅（URL 格式已实测验证）
- **方案来源可点击**：MAA 作业 → **`https://prts.plus/operation/{id}`**；B站视频 → `https://www.bilibili.com/video/{bvid}`（均新标签打开）。
  - ⚠️ **实测修正**：原文档写的 `https://prts.plus/copilot/{id}` **在现版本已不存在**——线上路由表只有
    `/`、`/create/:id`、`/editor/:id`、`/operation/:id`、`/profile/:id`、`/about`；用真实作业 id `105144`
    在浏览器打开 `/operation/105144` 正常渲染（标题「卫戍协议:盟约」、干员「空构」）。故一律用 `/operation/{id}`。
- **关卡标题可点击**：`VEC-SP02（心中热火）` → prts.plus 该关作业列表页。
  - ⚠️ **实测修正**：prts.plus **不支持按关直链**——筛选状态存在前端本地（含 `?levelKeyword=act2break_sp02`
    的 URL 实测不生效，列表未过滤），站点也没有关卡页路由。故链接到**作业站首页** `https://prts.plus/`，
    悬停提示说明「打开后点『关卡』筛选该关，或把显示码/通名粘进搜索框」（搜索框实测按显示码可搜到该关作业）。
  - 另提供了 `maaLevelUrl()` 单一入口，站点将来支持直链时只改这一处。

### 9.3 候选方案勾选 → 占用实时置灰（核心交互）✅
- 每个派遣关的候选方案支持**单选勾选**（同一关只占一套方案）；勾选框 `data-stage`/`data-scheme` 标识方案，
  勾选态存 `chrome.storage.local.dispatchPicks`（关卡 → `{key, ops, label}`），刷新/重开面板可恢复；
- 勾选行为：
  1. 写入 `lockedOps`（该方案干员 → 关卡标签）；**同关旧方案的干员自动移除**（同关不重复占）；
     跨关共用同一干员时改挂最新勾选关的标签，取消后回到仍在勾选的那一关；
  2. **实时重渲染**下方适配结果（无需重新分析）：被占用干员名 → **灰色 + 删除线 + 🔒**；替代建议列表中已被占用的候选同样置灰；
  3. 取消勾选 → 移出 lockedOps + 实时恢复颜色；
- 视觉定义：`.occupied { color:#999; text-decoration:line-through; }`（复用 🔒 徽章），content 面板与 popup 都加了 CSS + 内联样式；
- 候选池内**本关自己锁定**的干员不置灰（它们是这一关要用的），被其它关占用才置灰；
- 与「➕ 本关阵容加入占用清单」按钮的关系：按钮保留为手动兜底，**候选池勾选是主路径**（空清单文案已改为主路径说明）。
- 实现：`dispatchPicks.ts`（`togglePick` 纯函数 + 存取）、`render.ts`（勾选框/置灰）、`content/index.ts` 与
  `popup/main.ts`（`#result` 事件委托 + `storage.onChanged` 跨入口同步实时重渲染）。

### 9.4 空清单引导（q3：过滤效果未体现）✅
占用清单为空时，推图关结果顶部提示：「勾选任意派遣关方案后，被占用干员将在此**实时置灰**（灰色 + 删除线 + 🔒，无需重新分析）」。
仅当结果里**确实有可勾选的派遣关方案**、且当前关卡不是派遣关时出现，避免空提示。

### 9.5 干员名修饰词清洗（q4.2：「高练机械师」进待确认队列）✅
- **定性**：这不是网页版算力问题（API 同样可能出现），是提取规范问题——练度修饰词被并入名字；
- **双层修复**：
  1. 提取 prompt 明确：「去掉练度/练度修饰词（高练/低练/满练/满配/专三/专二/专一/满潜/满级/精二/精一/模组/XX级）只取干员名」；
     `roster.ts`（name 规则）与 `miner.ts`（replacement 规则 + 合并提示词的 roster 说明）都补了这条；
  2. 程序层兜底 `src/shared/nameClean.ts` 的 `stripModifiers(name)`：校验前剥离修饰前缀/后缀/括号重试字典匹配（高练机械师 → 机械师 ✓）；
     **清洗命中则正常使用、不进入 corrections_pending**；
- 保守原则：只剥「整词」修饰（高练/专三/满配/3级/三潜…），不剥单字（干员「小满」结尾就是「满」），
  且调用方（`OperatorDB.resolve`）**只在原名查不到字典时**才用剥离结果，绝不改坏已识别的真名。
- 附带修正：`stripModifiers` 已按 MAA 关卡库同理核对过不误伤（本次仅用于干员名，规则见 `nameClean.ts` 注释）。

### 9.6 网格通名 OCR 聚焦（实测显示「特别战线」被当成通名）✅
- prompt 侧（`miner.ts` 输出说明）：通名 OCR **只读黄色格内部的名称文字区域**，不读格子外的界面标题/栏目名/按钮文案
  （「特别战线」「矢量突破」「选择关卡」「作战」等一律不算通名，宁可留空）；`matchedName` 与 `gridCells[].name` 都写明。
- 程序侧（`stageResolver.ts` 的 `sanitizeStageName`）：命中界面文案黑名单即视为**没读到通名**（留空），
  位置规则正常生效、不再误报冲突；黑名单已拿 MAA 关卡库 2367 个真实关卡名核对（唯一冲突项「集火-1」故未纳入 `^集火`）。
- 冲突提示保留（位置优先）：「投资回报」这类**真实通名**与位置推算不一致时仍提示并标 `needsVerification`。

### 9.7 GitHub Pages（q4，**已完成，仅供记录**）
编辑器 404 原因：仓库 Pages 未开通。已通过 API 开通（source: main /docs）：
`https://tingfengsusu.github.io/Video2Team/alias-editor/`（首次部署约 1-2 分钟生效）。
新增别名（同批已完成）：`天猫→凯尔希·思衡托`、`异格银灰→凛御银灰`、`理→结城理`（共 355 条）。

### v4.3 验收标准
- 候选方案带「MAA作业/B站视频」标签与可点击来源链接；
- 勾选 VEC-SP02 任一方案 → 下方结果中该方案干员**立即变灰+删除线+🔒**，无需重新分析；取消勾选立即恢复；
- 「高练机械师」类输入不再进入昵称纠错队列；「机械师」正常识别；
- 网格截图识别不再把"特别战线"标题误读为通名。

**实现状态**：以上 4 条均由 `npm run selftest:v43` 覆盖并全部通过（52 项 PASS）。

---

## 变更记录

- **v4.3 实现（2026-10-08 晚）**：§9 七项**全部实现并通过验收自测**（`npm run selftest:v43`，52 项 PASS；同时回归 `selftest:stage`/`maa`/`bili`/`feedback` 全绿）。关键落点：
  ① 标签与提示统一在 `dispatchPool.ts`（`SOURCE_LABELS`/`SOURCE_TIPS`）；
  ② 链接 URL 实测修正：MAA 作业页为 **`prts.plus/operation/{id}`**（旧 `/copilot/{id}` 已失效），
     prts.plus 无按关直链（`?levelKeyword=` 不生效）故关卡标题链到作业站首页 + 悬停说明；
  ③ 新增 `dispatchPicks.ts`（勾选态 + `togglePick` 纯函数）、`render.ts` 勾选框/`.occupied` 置灰、content 与 popup 共用同一逻辑；
  ④ 新增 `nameClean.ts`（`stripModifiers`）并在 `OperatorDB.resolve` 校验前兜底重试，清洗命中不进 `corrections_pending`；
  ⑤ `stageResolver.sanitizeStageName` 过滤界面文案（黑名单已按 MAA 关卡库 2367 个真实关卡名核对）。
- **v4.3（2026-10-08 晚，第二轮实测）**：新增 §9 修复清单（7 项）——数据源标签改名 / 候选池可点击链接 / **勾选方案→占用实时置灰** / 空清单引导 / 修饰词清洗（高练机械师类）/ 网格通名 OCR 聚焦 / Pages 开通记录；同批完成：GitHub Pages 开通（main /docs）+ 3 条别名入库（天猫/异格银灰/理，共 355）。
- **v4.2（2026-10-08 晚）**：用户实测反馈两项缺陷修复设计——①关卡类型分流（目标关不显示「加入占用清单」，见 §1「实测缺陷修复」）②派遣关编号识别（特别战线网格位置规则：从上到下、从左到右）；§0 与 §8 进度更新（六项已实现，stash 清空）。**两项均已实现并验证通过（2026-10-08 晚）**。
- **v4.1（2026-10-08）**：启动指令提至文档顶部（复制即用）；§5 FEEDBACK_MID 待办醒目标注（含未配置时的降级行为）；设计文档已推送 origin/main（截至 `720a69b`）。
- **v4.0（2026-10-08）**：七项设计汇总成文（派遣占用 / MAA数据源 / 三级挖掘 / 别名编辑器 / 反馈私信 / 结果缓存 / 点赞致谢）。
