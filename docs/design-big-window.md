# 大窗口结果页 · 两版设计对比

同一份数据（`renderResultSections` 输出），两种视觉/信息架构。用于挑选后再合并。

> 本文件写在 `design/big-window-dashboard` 分支上；`main` 上是设计 A。

## 设计 A ——「卡片面板」（main 分支）

| 维度 | 取值 |
|------|------|
| 风格 | 轻量卡片：灰底 + 白卡 + 12px 圆角、青色强调 |
| 配色 | 中性灰（#f6f8fa 底 / #e6e8eb 线）+ 强调 #23ade5 |
| 字体 | 系统字体（system-ui / 微软雅黑） |
| 图标 | emoji（🎯 🚩 🔒 ✅ ⬜ ⚠ ✕） |
| 布局 | 顶部 chips 条 → 两栏：左=本关阵容（主）· 右=总览 + 候选池 + 占用清单 |
| 信息密度 | 中（正文 13–14px，行高 1.65） |

## 设计 B ——「Data-Dense Dashboard」（本分支）

依据 `ui-ux-pro-max` 技能的设计系统查询结果实现（查询：`browser extension strategy dashboard dense gaming data tool --design-system`）：

| 维度 | 取值 |
|------|------|
| 风格 | Data-Dense Dashboard：KPI 卡 + 网格 + 行高亮 + 最小留白，**数据可见性优先** |
| 配色 | 蓝数据 + 琥珀强调：primary `#1E40AF` / secondary `#3B82F6` / accent `#D97706` / bg `#F8FAFC` / border `#DBEAFE` / destructive `#DC2626` |
| 字体 | **Fira Sans**（界面）+ **Fira Code**（关卡号/计数，`tabular-nums`） |
| 图标 | **内联 SVG**（Lucide 风格）—— 技能清单明确要求「不要用 emoji 当图标」，所以本版把 🎯🚩🔒✅⬜⚠✕↗ 全部替换为 SVG 或文字（`plainIcons` 开关，默认关闭，仅大窗口开启） |
| 布局 | 顶栏（SVG 按钮）→ **KPI 条**（本关阵容 / 已替换 / 无解 / 前置关已选 / 占用干员，等宽大数字）→ 上下文条 → 两栏：**左=前置关候选池（主交互）** · 右=本关阵容 + 占用清单（吸顶） |
| 交互 | **关卡筛选**（全部 / 未选 / 已选）+ **方案搜索**（干员·标题·来源）、行 hover 高亮、可见 focus ring、200ms 过渡、按下反馈 |
| 信息密度 | 高（正文 13px / 行高 1.5、KPI 大数字、行内计数右对齐） |

### 依据（技能查询要点）

- 风格首选 **Data-Dense Dashboard**（关键词：KPI cards、grid layout、space-efficient、maximum data visibility）
- 配色 **Blue data + amber highlights**；避免「紫色 AI 渐变」、避免多强调色（taste-skill）
- 字体 **Fira Code / Fira Sans**（mood：dashboard, data, analytics, precise）
- 交互要点：hover tooltips、**row highlighting on hover**、smooth filter animation、visible focus、contrast ≥ 4.5、不做 hover-only 的关键操作
- 反模式：emoji 当图标、无筛选、装饰过度

### 同一套数据、两版共用的实现

- `render.ts` 新增 `plainIcons`（emoji→文字/SVG）与 `showGuidesHeading` / `showSlotsHeading`（页面自带头部时关掉渲染层标题）；
  默认值保持现状，因此 `main` 分支的面板/popup 不受影响。
- 候选池行的 `data-stage` / `data-picked` / `data-ops` / `data-search` 属性供两版做筛选或高亮。

### 第三轮微调（用户实测反馈）

- **字号上调**：基准 13 → **14px**（行高 1.5 → 1.6），辅助文字 11 → 12px，槽位 13 → 14px；
- **去掉 KPI 条**：人数/替换/无解/占用在候选池行与阵容里都能看到，单列一排行信息密度反而下降；
- **右栏只留「本关适配阵容」**：原先的「总览块（本关用这套 + 前置关状态）」与「占用清单 chips」
  与左侧候选池重复（候选池行已经写着「已选 凯尔希·能天使」/「未选」，勾选与取消也在那里），故移除；
- 与 main 共用的功能修复（两端都有）：**识别依据**行（「特别战线网格第 5 格，格内读到『催化装备』」）、
  每关「**不是这关**」排除 + 底部「恢复」、方案行**只留一个链接**（来源标签即链接）、
  整行点击=勾选、顶部「✕ 关闭」+ Esc 关闭、大窗口**复用**（不再每次都新开窗口）。

### 第四轮微调（第九轮实测反馈，2026-10-09）

- **纠错入口收敛**：删除每关的「改成…」下拉（用户明确不需要），只留底部一行
  「漏识别了某一关？［＋ 补一个关…］」，下拉**只列候选池里还没出现的关**，控件统一走 `.stage-select`
  类（面板 / popup / 设计 A 大窗口 / 设计 B 大窗口四处同一套标记；本页用设计 B token 上色，
  hover/focus 可见、200ms 过渡）；
- **被占用的方案保留展示**：候选池只隐藏**缺干员**的方案；被其它关占用的**留在行里**
  （干员灰+删除线+「占用」徽章，行尾标注「（已被 VEC-SP05 占用，勾选本方案会把占用改到本关）」），
  点它即可把占用抢回本关；
- **本页字号再上调一档**：方案行/关卡头 12 → **13px**（页面级 `!important` 覆盖渲染层行内字号）、
  辅助文字 11 → **12px**、下拉 13px——与页内面板观感对齐（用户反馈大窗口"看着小、不协调"）。

### 怎么选

- 想要「一眼看清前置关用了什么」、界面轻 → **A**
- 想要「数据密度高、抄作业时信息全在屏上、有筛选」→ **B**
- 也可以混：B 的 KPI 条 + 筛选 + SVG 图标 与 A 的宽松排版组合（再说一声即可）。
