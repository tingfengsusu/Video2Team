/** 临时合并解冲突脚本（用完即删）：把 main 的新功能并入分支的 plainIcons 版本。 */
import { readFileSync, writeFileSync } from "node:fs";

const resolveFile = (file, blocks) => {
  const raw = readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  let s = raw.replace(/\r\n/g, "\n");
  const re = /<<<<<<< HEAD\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> main\n/g;
  let i = 0;
  s = s.replace(re, (_m, ours, theirs) => {
    const pick = blocks[i];
    i += 1;
    if (pick === "ours") return ours;
    if (pick === "theirs") return theirs;
    if (typeof pick === "string") return pick;
    throw new Error(`${file} 第 ${i} 块未指定解`);
  });
  if (i !== blocks.length) throw new Error(`${file} 冲突块数不符：实际 ${i}，期望 ${blocks.length}`);
  writeFileSync(file, crlf ? s.replace(/\n/g, "\r\n") : s);
  console.log(`resolved ${file}（${i} 块）`);
};

// render.ts：6 块——统一取「分支的 plainIcons 版 + main 的功能」并集
resolveFile("src/shared/render.ts", [
  // 1) ResultRenderOptions：两边都要
  `  /** 是否输出「本关适配阵容」分区标题（大窗口页用卡片标题时置 false） */
  showSlotsHeading?: boolean;
  /** 不用 emoji 标记（大窗口「设计 B」按技能规范改用文字/SVG） */
  plainIcons?: boolean;
  /** 每关识别依据（P1 网格位置 / 格内名称），让「识别错了」可见可纠 */
  guideEvidence?: Record<string, string>;
  /** 用户手动排除的关卡显示码 */
  excludedStages?: string[]`,
  // 2) 方案来源标签：main 的单链接 + 分支的 plainIcons 图标（去掉尾部重复链接）
  `      \`aria-label="\${esc(\`打开\${unit}页：\${scheme.title || scheme.stageName}\`)}" \` +
      \`title="\${esc(\`\${tip}｜点击打开该\${unit}页\`)}">\${esc(labelText)}\${
        plainIcons
          ? \`<svg class="ext-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v6H4V6h6"/></svg>\`
          : "↗"
      }</a>\`
    : \`<span style="color:\${color};font-weight:700" title="\${esc(tip)}">\${esc(labelText)}</span>\`;
  // 每行只留**一个链接**（来源标签本身）：原先尾部的「视频页↗/作业页↗」与它重复，两处链接容易误点`,
  // 3) 行模板：分支版（含 plainIcons）
  "ours",
  // 4) renderDispatchGuides 选项：两边都要
  `    /** 不用 emoji 标记（大窗口「设计 B」按技能规范改用文字/SVG） */
    plainIcons?: boolean;
    /** 每关识别依据（显示码 → 「网格第 5 格（格内「催化装备」）」） */
    evidence?: Record<string, string>;
    /** 用户手动排除的关卡显示码（识别不准时改） */
    excludedStages?: string[]`,
  // 5) pickLine + 识别依据：plainIcons 版 + main 的依据行
  `        ? \`<span style="color:#1a7f37">\${opts.plainIcons ? "已选" : "✅"} \${picked.ops.map((n) => esc(n)).join("·")}</span>\`
        : \`<span class="dim">\${opts.plainIcons ? "未选" : "⬜ 未选"}</span>\`;
      // 识别依据（P1 网格第几格 / 格内名称 / 是否需核实）：让「识别错了」一眼可见
      const evidence = opts.evidence?.[pool.displayCode.toUpperCase()] ?? "";
      const evidenceLine = evidence
        ? \`<div class="hint" style="margin-top:1px">识别依据：\${esc(evidence)}</div>\`
        : "";`,
  // 6) renderResultSections 传参：两边都要
  `    plainIcons: options.plainIcons,
    evidence: options.guideEvidence,
    excludedStages: options.excludedStages,`,
]);
