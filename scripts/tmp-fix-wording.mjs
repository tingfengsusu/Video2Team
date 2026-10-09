/** 临时补丁（用完即删）：main 补 data-ops/data-search + 去掉误导性的「P1」措辞。 */
import { readFileSync, writeFileSync } from "node:fs";

const edit = (file, pairs) => {
  const raw = readFileSync(file, "utf8");
  const crlf = raw.includes("\r\n");
  let s = raw.replace(/\r\n/g, "\n");
  for (const [a, b, tag] of pairs) {
    if (!s.includes(a)) throw new Error(`${file} 锚点缺失: ${tag}`);
    s = s.replace(a, b);
  }
  writeFileSync(file, crlf ? s.replace(/\n/g, "\r\n") : s);
  console.log("patched", file);
};

// ① 方案行补 data-ops / data-search（勾选兜底要用；设计分支上已有，main 漏了）
edit("src/shared/render.ts", [
  [
    `    \`<div class="schemerow" data-pick-row="1" \` +`,
    `    \`<div class="schemerow" data-pick-row="1" \` +
    \`data-ops="\${esc(scheme.operators.join("、"))}" \` +
    \`data-search="\${esc([scheme.sourceLabel, scheme.mode, scheme.title, scheme.author, scheme.operators.join("")].filter(Boolean).join(" "))}" \` +`,
    "data-attrs",
  ],
  // ② 措辞：不再自称 P1（截图顺序已随意）
  [
    `  /** 每关识别依据（P1 网格位置 / 格内名称），让「识别错了」可见可纠 */`,
    `  /** 每关识别依据（特别战线网格位置 / 格内名称），让「识别错了」可见可纠 */`,
    "opt-doc",
  ],
  [
    `      // 识别依据（P1 网格第几格 / 格内名称 / 是否需核实）：让「识别错了」一眼可见`,
    `      // 识别依据（网格第几格 / 格内名称 / 是否需核实）：让「识别错了」一眼可见`,
    "evidence-comment",
  ],
  [
    `          "🚩 P1 派遣关攻略",`,
    `          "🚩 特别战线候选池",`,
    "heading",
  ],
]);

// ③ 后台的识别依据文案：P1 → 截图里的特别战线网格（顺序不再固定）
edit("src/background/index.ts", [
  [
    `  // 识别依据：把「模型看到的是第几格 / 格内读到什么」摊开给用户看；`,
    `  // 识别依据：把「模型看到的是第几格 / 格内读到什么」摊开给用户看（截图顺序不固定，故不写"P1"）；`,
    "bg-comment",
  ],
  [
    `    if (c.gridPosition) parts.push(\`P1 网格第 \${c.gridPosition} 格\`);`,
    `    if (c.gridPosition) parts.push(\`特别战线网格第 \${c.gridPosition} 格\`);`,
    "bg-evidence",
  ],
]);

// ④ stageResolver 的提示文案：去掉 P1 前缀
edit("src/shared/stageResolver.ts", [
  [
    `      mismatchNotes.push(\`P1 通名“\${hint.name}”不在关卡库中，已按网格位置采用 \${mapped.level.displayCode}\`);`,
    `      mismatchNotes.push(\`网格内文字“\${hint.name}”不在关卡库中，已按网格位置采用 \${mapped.level.displayCode}\`);`,
    "sr-1",
  ],
  [
    `    ? \`P1 网格位置 \${invalidPositions.join("、")} 超出该活动的派遣关范围\``,
    `    ? \`网格位置 \${invalidPositions.join("、")} 超出该活动的派遣关范围\``,
    "sr-2",
  ],
]);
