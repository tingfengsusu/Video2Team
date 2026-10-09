# 🎮 Video2Team · 方舟抄作业适配器

**把大佬的作业，改成你抄得动的作业**

> 浏览器插件（Chrome / Edge，MV3）：看B站明日方舟攻略视频时一键分析 —— AI 识别画面里的**编队阵容** → 挖出弹幕/评论里的**「XX 可以换 XX」实战建议** → 和你导入的**干员练度表**逐一比对 → 给出**你能抄的阵容**，并算出**打活动要打哪些补给关、谁先打谁、会不会互相占干员**。

**当前版本：v0.3.0**（见 [Releases](../../releases)）。设计文档：[docs/design-v4.md](docs/design-v4.md)（§9/§10 是历次实测反馈与修复清单）、[docs/design.md](docs/design.md)（早期设计）。

---

## ✨ 现在能做什么（v0.3.0）

**四个界面**：视频页右缘滑出的**面板**、扩展**弹窗**、**设置页**、以及独立的**大窗口结果页**（悬浮窗，与面板/弹窗勾选双向实时同步）。

**① 抄作业适配（主流程）**

- 截取/粘贴「编队画面」→ 识别阵容 → 每位干员标注 **绿=你有 / 红=你没有**；
- 缺的干员优先给**弹幕/评论里的实战替代**，每条都带原文 + **溯源链接**（跳回原评论）；关键位替换标红提示；
- 干员名支持**社区昵称/黑话还原**（300+ 条，在线更新）、**练度修饰词剥离**（「高练机械师」→「机械师」）、**单字干员名边界匹配**（黑/黍/令，不误伤「黑角」）；
- 不认识的称呼会进「昵称纠错」，确认一次即可复用（网页版编辑器：[alias-editor](https://tingfengsusu.github.io/Video2Team/alias-editor/)）。

**② 特别战线 / 补给关（矢量突破这类活动）**

- 从截图里的补给网格**按序号自动认关**（顺序 = 从上到下、从左到右），并写出**识别依据**（「特别战线网格第 5 格 → VEC-SP02」），认错一眼可见，可用「不是这关」剔除；
- 每关给一份候选池：**MAA 作业站** + **B站 攻略视频**两条来源分列、可点击直达；与 MAA 同阵容的会去重（条数可见）；
- **勾选 = 占用**：被其它关占用的方案保留并置灰 + 标注「已被哪一关占用，勾选会把占用改到本关」；缺干员的方案默认折叠，可「点开查看」；
- **关卡链**：SP10 → 先打 SP09、SP12 → 先打 SP11，自动把前置关也纳入候选池；
- **「选择补给关…」**：按序号点选的网格浮层（按住拖动连续选、可取消识别错的关），应用后现查并入。

**③ 体验细节**

- 结果按「视频 + 分P」缓存；换视频/分P 不再串结果；可「清除本页缓存」；
- 启动公告（读仓库 `docs/announcement.json`）；发现新版在面板顶部提示 + 「复制升级步骤」。

---

## 📥 安装

**普通用户（无需开发环境）**

1. 到 [Releases](../../releases) 下载最新的 `Video2Team_vX.Y.Z.zip`；
2. **解压**到任意目录（先解压再操作）；
3. Chrome 打开 `chrome://extensions`（Edge 为 `edge://extensions`），打开右上角「**开发者模式**」；
4. 点「**加载已解压的扩展程序**」→ 选中解压出来的文件夹（内含 `manifest.json` 那一层）。

**更新**：插件发现新版会在面板顶部提示。

- 本机有 git + node：在仓库目录跑 **`npm run selfupdate`**（= `git pull --ff-only && npm run build`），再回 `chrome://extensions` 点「刷新」；
- 没有环境：下载新 zip → **解压覆盖**原来的文件夹 → 点「刷新」；
- 已打开的B站页面按 F5 重新加载一次即可。

**开发者（从源码构建）**

```bash
git clone https://github.com/tingfengsusu/Video2Team.git
cd Video2Team
npm install
npm run build        # 构建产物在 dist/
npm run pack         # （可选）打成可发布的 zip：Video2Team_v{版本}.zip
```

构建完同上第 3-4 步，第 4 步选 `dist/`。

**首次使用（1 分钟）**

1. 点插件图标 →「⚙ 设置」；
2. **干员 box**：从 [一图流](https://ark.yituliu.cn/survey/operators) 导出 Excel 并上传（**本地解析，不上传**）；
3. **AI 接口**：选「**DeepSeek 网页版（推荐，免 Key）**」保存即可（分析时在网页版按一次回车，插件自动读回复）；或选「API 直连」填自己的 Key（任意 OpenAI 兼容：DeepSeek／硅基流动／智谱／Kimi／通义／豆包／OpenAI／OpenRouter／本地 Ollama + 自定义端点）。

> 上架插件商店是后续计划；当前分发方式 = Releases zip + 开发者模式安装。

---

## 💡 解决什么问题

活动关挂机攻略的经典痛点：

1. 攻略阵容里有干员，我没有；
2. 「XX 可以用 YY 代替」散落在几百条弹幕/评论里；
3. 打活动还要自己数「要打哪几个补给关、谁先打谁、打了会不会占掉别的关要用的干员」。

Video2Team 把这几步压缩成一次点击：**看视频时点一下插件，直接得到我能抄的阵容 + 这关的前置关怎么摆**，每个替换位都标注来源、替代类型与风险等级。

## 🔄 设计范式

与 [Video2Shop](https://github.com/tingfengsusu/Video2Shop) 同一范式的领域迁移：**视频 → 清单 → 对比持有 → 补齐方案**（配方→京东加购 ⟶ 阵容→替补填坑）。

```
① 阵容提取            ② 替代知识挖掘                 ③ 匹配推荐 + 占用规划
截图编队 AI 识别  →   a. 弹幕/评论区（实战建议，带溯源）  →   我有→保留
                      b. B站 标题/分P（攻略方案，字典匹配）   没有→命中替代→采用
                      c. MAA 作业站（机器可读作业）          无解→标红，回评论区确认
                      → 字典/别名校验防幻觉                 派遣关：勾选即占用，跨关冲突置灰
```

## 📌 核心设计决策

- **形态 = 浏览器插件**（MV3 + TypeScript + esbuild）：管道全是轻请求，无重计算；B站请求带用户登录态，风控最友好；
- **数据只走 API，不解析页面 HTML**：MAA 作业站（`prts.maa.plus`）+ B站搜索/评论/弹幕接口；
- **分析单元 = 单个分P**：合集 = 一关一视频的系列，弹幕/评论天然按关卡隔离；
- **box 导入**：一图流导出的 Excel（SheetJS 前端解析）+ 本地缓存；Excel 永久兜底；
- **替代知识分层**：实战验证（弹幕/评论，可溯源）> B站 攻略标题 > MAA 作业；干员字典只做名字校验防幻觉，**不发明建议**；
- **风险分级**：关键位替换一律高风险标注，提示回评论区确认；
- **占位模型**：勾选方案 = 占用干员；同关自动换选、跨关共享干员改挂最新勾选关，取消后回到仍勾着的关。

## 🗂 目录结构

```
Video2Team/
├── manifest.json                 # MV3 清单（版本号在这里；更新提示与 docs/version.json 比对）
├── docs/
│   ├── design-v4.md              # 主设计文档（§0 状态 / §9 §10 实测反馈与修复 / 变更记录）
│   ├── announcement.json         # 启动公告源（插件读它）
│   ├── version.json              # 最新版本源（插件据此提示更新）
│   ├── promo-xiaoheihe*.md       # 社区发帖稿
│   └── data-sources.md           # 数据来源与许可
├── src/
│   ├── background/index.ts       # Service Worker：消息路由 + 分析管道 + 大窗口管理
│   ├── content/index.ts          # 视频页面板（含 SPA 换视频重置、公告/更新条）
│   ├── popup/                    # 扩展弹窗
│   ├── options/                  # 设置页（box 导入 / AI 模式 / 昵称纠错 / 公告 / 版本与更新）
│   ├── result/                   # 大窗口结果页
│   └── shared/                   # 主要逻辑（节选）
│       ├── roster.ts             # ① 阵容提取（提示词 + 解析）
│       ├── miner.ts              # ②a 弹幕/评论替代建议（合并提示词 / 解析）
│       ├── biliDig.ts            # ②b B站 攻略挖掘（标题/分P、字典提取、合集与时间窗过滤）
│       ├── maa.ts                # ②c MAA 作业站（关卡库 / 作业查询）
│       ├── dispatchPool.ts       # 候选池合并去重（含「与 MAA 同阵容」去重计数）
│       ├── dispatchGuides.ts     # 候选池构建（MAA + B站 配额、12h 挖掘缓存）
│       ├── dispatchPicks.ts      # 勾选态（dispatchPicks）与占用切换纯函数
│       ├── stageResolver.ts      # 关卡识别（显示码/通名/网格序号、模型 note 兜底解析）
│       ├── stageKind.ts          # 推图关 / 派遣关分流
│       ├── render.ts             # 结果渲染（面板/弹窗/大窗口共用，含候选池与勾选）
│       ├── gridPicker.ts         # 「选择补给关…」浮层交互
│       ├── recommender.ts        # ③ 匹配推荐（保留/替换/无解 + 风险）
│       ├── resultCache.ts        # 结果缓存（按 视频+分P，7 天 / 30 条）
│       ├── announcement.ts       # 启动公告
│       ├── versionCheck.ts       # 更新检查（比对 docs/version.json）
│       └── remoteFile.ts         # 仓库小 JSON 取源（jsdelivr 与 raw 并行 + 超时）
├── data/                         # 干员字典 / 别名表（内置兜底）
└── scripts/                      # 构建、打包、自测、开发夹具
```

## 🧪 开发与自测

```bash
npm run typecheck      # tsc --noEmit
npm run build          # esbuild 多入口 → dist/
npm run selfupdate     # git pull --ff-only && npm run build（升级自己）

# 五套离线自测（Node 直接跑真模块；maa 那套会联网）
npm run selftest:v43      # 主线：候选池/勾选/关卡识别/提示词口径（130+ 项）
npm run selftest:stage    # 关卡分流与特别战线网格识别
npm run selftest:maa      # MAA 作业站（关卡库、作业查询、断网降级）
npm run selftest:bili     # B站 挖掘（字典提取、过滤规则）
npm run selftest:feedback # 反馈私信与降级分支

# 可点击的开发夹具（真 content.js / 真 result.js）
node scripts/dev-panel-fixture.mjs      # 生成假B站视频页（外观照真实页面做的）
node scripts/dev-bigwindow-fixture.mjs  # 生成大窗口夹具
node temp/panel-fixture-server.cjs      # 静态服务（8787）
#  面板：http://127.0.0.1:8787/video/BV1TEST?p=2
#  大窗口：http://127.0.0.1:8787/temp/bigwindow-fixture.html
```

**分支说明**：`main` = 大窗口「设计 A（卡片）」，`design/big-window-dashboard` = 「设计 B（Data-Dense Dashboard）」；两版大窗口并存等选定，其余功能两侧同步（详见 [docs/design-big-window.md](docs/design-big-window.md)）。

## 🗺️ 路线图

- ✅ **v0.3.0（当前）**：特别战线/补给关自动认关与候选池、勾选占用与跨关冲突、关卡链、选择补给关浮层、大窗口结果页、结果缓存与换视频重置、启动公告、更新提示
- ✅ **v0.2.x**：画面识别阵容、弹幕/评论建议挖掘、box 适配（红绿标注）、网页版免 Key 与 API 双模式、字典/昵称在线更新、昵称纠错闭环、MAA 作业站数据源、B站 三级挖掘
- 🔜 **下一步**：插件商店上架（自动更新）、合集整条批量分析、结果导出/分享
- 🚫 **明确不做**：让模型凭空发明替代建议、长视频分段路由

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 插件运行时 | Chrome Manifest V3（Edge 兼容） |
| 语言/构建 | TypeScript + esbuild（各入口单文件 bundle） |
| Excel 解析 | SheetJS (xlsx)，纯前端本地解析 |
| AI 分析 | 任意 OpenAI 兼容接口（预设 DeepSeek/硅基流动/智谱/Kimi/通义/豆包/OpenAI/OpenRouter/本地 Ollama + 自定义） |
| 数据 | MAA 作业站 API、B站公开 API、干员字典（[一图流开源数据](docs/data-sources.md)）、社区昵称对照（[猜猜乐插件](docs/data-sources.md) + 本地积累） |

## 📚 数据来源与致谢

干员字典、昵称对照等数据全部来自社区开源项目（[一图流](https://ark.yituliu.cn/)、[猜猜乐插件](https://github.com/Li-shi-ling/astrbot_plugin_mrfzccl)、[MAA 作业站](https://prts.maa.plus/) 等），详见 [docs/data-sources.md](docs/data-sources.md)。

## 📄 许可证

本仓库代码基于 MIT License。游戏角色名称与内容版权归鹰角网络所有；内置数据的来源与许可详见 [docs/data-sources.md](docs/data-sources.md)。
