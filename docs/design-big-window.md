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

### 怎么选

- 想要「一眼看清前置关用了什么」、界面轻 → **A**
- 想要「数据密度高、抄作业时信息全在屏上、有筛选」→ **B**
- 也可以混：B 的 KPI 条 + 筛选 + SVG 图标 与 A 的宽松排版组合（再说一声即可）。
