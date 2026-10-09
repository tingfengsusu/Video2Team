/** 临时合并解冲突脚本（用完即删）：result/main.ts 与 index.html。 */
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

resolveFile("src/result/main.ts", [
  // 1) 状态：筛选 + 搜索（分支）与排除列表（main）都要
  `/** 关卡筛选：all / unpicked / picked */
let stageFilter: "all" | "unpicked" | "picked" = "all";
/** 方案搜索词（匹配干员 / 标题 / 来源） */
let query = "";
/** 本页被用户手动排除的前置关（识别不准时用） */
let excludedStages: string[] = [];`,
  // 2) renderResultSections 选项：分支的 plainIcons/标题开关 + main 的依据/排除
  `    showGuidesHeading: false, // 由面板标题承担
    showSlotsHeading: false, // 同上
    plainIcons: true, // 设计 B：不用 emoji 标记（技能规范），图标走内联 SVG
    guideEvidence: current.dispatchGuideEvidence,
    excludedStages,
  });`,
  // 3) loadLocal：分支的 advanced 读取 + main 的排除列表读取（整块取 main 的 loadLocal 再补 advanced？）
  //    这里两端分别是「分支 loadLocal 尾部」与「main loadLocal 尾部」，取并集
  `  colorBySource = advanced?.colorBySource !== false;
  picks = await loadPicks();
  overrides = await getStageKindOverrides();
  const { dispatchStageSkips } = (await chrome.storage.local.get("dispatchStageSkips")) as {
    dispatchStageSkips?: Record<string, string[]>;
  };
  const skipKey = current ? \`\${current.bvid}|\${current.roster.page ?? 0}\` : "";
  excludedStages = skipKey ? dispatchStageSkips?.[skipKey] ?? [] : [];`,
]);
