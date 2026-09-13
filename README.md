# 🎮 Video2Team

**把大佬的作业，改成你抄得动的作业**

> 浏览器插件：在看B站明日方舟挂机攻略视频时一键分析 —— AI 提取阵容 → 结合弹幕/评论区实战替代建议 + 我的干员 box → 输出一份我当前 box 能用的阵容。

🚧 **当前状态：设计完成，骨架搭建中**（设计文档：[docs/design.md](docs/design.md)）

---

## 💡 解决什么问题

活动关挂机攻略的经典痛点：

1. 攻略阵容里有干员，我没有；
2. 「XX 可以用 YY 代替」的建议散落在几百条弹幕/评论里；
3. 一个个记、一个个核对、一个个试——太累。

Video2Team 把这三步压缩成一次点击：**看视频时点一下插件，直接得到我抄得动的阵容**，每个替换位都标注来源（原阵容 / 实战建议 / 泛化知识 / AI 推断）、替换类型和风险等级。

## 🔄 设计范式

与 [Video2Shop](https://github.com/tingfengsusu/Video2Shop) 是同一范式的领域迁移：**视频 → 清单 → 对比持有 → 补齐方案**（配方→京东加购 ⟶ 阵容→替补填坑）。

```
① 阵容提取        ② 替代知识挖掘（两路）      ③ 匹配推荐
简介/置顶评论  →   a. L3实战：弹幕/评论    →   我有→保留
(抽帧OCR兜底*)     b. L2泛化：UP主图表帧       没有→L3命中→采用
                  → 字典校验防幻觉            无解→L2条件匹配→LLM推断
                                    →  输出：阵容+来源+类型+风险标注
```

\* 抽帧 OCR 兜底依赖 v1+ 的可选本地分析服务，主流程不依赖。

## 📌 核心设计决策

- **形态 = 浏览器插件**（MV3 + TypeScript + Vite）：v0 管道全是轻请求，无重计算；入口体验最好；B站请求带用户登录态，风控最友好；Edge 商店 + crx 双通道分发；
- **分析单元 = 单个视频**：攻略合集 = 一关一视频的系列，弹幕/评论天然按关卡隔离，无需路由；
- **box 导入**：v1 用[一图流](https://ark.yituliu.cn/survey/operators)导出的 Excel（SheetJS 前端解析），v2 上森空岛扫码登录，Excel 永久兜底；
- **替代知识三层体系**：L2 泛化知识（UP主替换分析图表帧提取）+ L3 实战验证（弹幕/评论挖掘）> LLM 推断兜底；干员字典只做名字典防幻觉 + 属性上下文，**不参与推荐**；替换类型多粒度（换干员/换技能/换位置/改手动）；
- **风险分级**：关键位替换一律高风险标注，提示回评论区验证——推荐翻车的容错远低于买错酱油。

## 📂 目录结构

```
Video2Team/
├── docs/design.md                  # 设计文档（管道/数据模型/版本规划/风险）
├── manifest.json                   # MV3 清单（@crxjs/vite-plugin 消费）
├── vite.config.ts / tsconfig.json / package.json
├── src/
│   ├── background/index.ts         # Service Worker：消息路由 + 管道编排
│   ├── content/index.ts            # 视频页识别 + 分析入口注入
│   ├── popup/                      # 弹出面板：结果展示
│   ├── options/                    # 设置页：API key、Excel 导入、box 管理
│   └── shared/
│       ├── types.ts                # 核心数据模型（Roster/Substitution/Box/...）
│       ├── bilibili.ts             # B站 API 封装（视频/置顶评论/评论/弹幕）
│       ├── deepseek.ts             # DeepSeek API 调用
│       ├── roster.ts               # ① 阵容提取
│       ├── miner.ts                # ②a 实战替代挖掘（L3）
│       ├── knowledge.ts            # ②b 泛化知识提取（L2，v1）
│       ├── box.ts                  # box 导入（Excel / 森空岛扫码）
│       ├── operatorDB.ts           # 干员名字典 + 属性上下文
│       └── recommender.ts          # ③ 匹配推荐引擎
├── data/                           # 干员数据 JSON（待落地）+ 缓存
└── tests/
```

## 🗺️ 版本规划

| 版本 | 内容 |
|------|------|
| **v0 (MVP)** | 视频页一键分析 + Excel box + 评论区（置顶/高赞）映射命中推荐，popup 展示结果 |
| **v1** | 合集遍历、弹幕挖掘、L2 泛化知识（图表帧提取，依赖可选本地服务）、LLM 补充推断、风险分级与溯源 |
| **v2** | 森空岛扫码登录、长视频分段兼容、L2 知识库积累与共享 |

详见 [docs/design.md](docs/design.md) §8。

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| 插件运行时 | Chrome Manifest V3（Edge 兼容） |
| 语言/构建 | TypeScript + esbuild（四入口单文件 bundle，规避 crxjs beta 的 chunk 问题） |
| Excel 解析 | SheetJS (xlsx)，纯前端本地解析 |
| AI 分析 | DeepSeek API（多模态） |
| 数据 | B站公开 API、干员数据 JSON（PRTS/一图流开源数据） |

## 📄 许可证

MIT License
