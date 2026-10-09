/**
 * 大窗口结果页的「静态预览」生成器（设计评审用，不影响扩展运行）：
 *
 *   node scripts/preview-result-page.mjs   →  temp/preview-result.html（用浏览器直接打开）
 *
 * 骨架与 CSS 直接取自 src/result/index.html（当前分支的版本），
 * 内容用真实 renderResultSections 拼装并按容器 id 注入，因此预览与真页面（result.html）
 * 除数据源（chrome.* storage）外一致。
 *
 * 兼容两种页面结构：
 * - 设计 A（main）：#stageName / #chips / #col-side / #locks
 * - 设计 B（design 分支）：#context / #col-pool / #col-main / #poolCount / #slotCount
 */
import * as esbuild from "esbuild";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outfile = join(mkdtempSync(join(tmpdir(), "v2t-preview-")), "m.mjs");
await esbuild.build({
  stdin: {
    contents: `export * from "../src/shared/render.ts";`,
    resolveDir: join(root, "scripts"),
    sourcefile: "preview-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node18",
  outfile,
  logLevel: "error",
});
const m = await import(pathToFileURL(outfile).href);

// ---------------- 示例数据（贴近实测：推图关 + 3 个前置关 + 勾选/占用/替换/无解） ----------------
const maa = (o) => {
  const merged = {
    source: "maa", sourceLabel: "MAA作业", displayCode: "VEC-SP02", stageName: "心中热火",
    operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }], mode: "单人", title: "", details: "",
    author: "", url: "", bvid: "", views: 0, hotScore: 0, ...o,
  };
  if (o.operators) merged.opers = o.operators.map((n, i) => ({ name: n, skill: i === 0 ? merged.opers[0]?.skill : undefined }));
  return merged;
};
const bili = (o) => {
  const merged = {
    source: "bili", sourceLabel: "B站视频", displayCode: "VEC-SP02", stageName: "心中热火",
    operators: ["泥岩"], opers: [{ name: "泥岩" }], mode: "挂机", title: "", details: "",
    author: "", url: "https://www.bilibili.com/video/BV1cuHe6DEF9", bvid: "BV1cuHe6DEF9",
    views: 0, hotScore: 0, ...o,
  };
  if (o.operators) merged.opers = o.operators.map((n) => ({ name: n }));
  return merged;
};
const pools = [
  {
    displayCode: "VEC-SP02", stageId: "act3break_sp02", stageName: "心中热火", counts: { maa: 5, bili: 3 },
    schemes: [
      maa({ copilotId: 105144, operators: ["凯尔希", "能天使"], opers: [{ name: "凯尔希", skill: 3 }, { name: "能天使", skill: 2 }], title: "凯尔希单核 简单好抄", author: "3675492780" }),
      bili({ operators: ["泥岩"], title: "泥岩单人两步 VEC-SP02 心中热火", author: "某UP" }),
      bili({ operators: ["提丰", "早露"], mode: "双人", title: "VEC-SP02 双人低配", author: "合集UP", url: "https://www.bilibili.com/video/BV1EqaH6gEAX?p=88", bvid: "BV1EqaH6gEAX", page: 12, collection: "VEC-SP01~14 矢量突破#3 特别战线合集" }),
      maa({ copilotId: 105145, operators: ["银灰"], mode: "低星", title: "银灰带队", author: "作业作者" }),
    ],
  },
  {
    displayCode: "VEC-SP07", stageId: "act3break_sp11", stageName: "荒废矿道", counts: { maa: 2, bili: 6 },
    schemes: [
      maa({ copilotId: 105001, displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["凯尔希", "史尔特尔"], title: "凯尔希+42 挂机", author: "作业作者" }),
      bili({ displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["令"], mode: "单人", title: "令 单人 荒废矿道", url: "https://www.bilibili.com/video/BV1zz", bvid: "BV1zz" }),
    ],
  },
  {
    displayCode: "VEC-SP12", stageId: "act3break_sp08", stageName: "四号站台", counts: { maa: 0, bili: 24 },
    schemes: [
      bili({ displayCode: "VEC-SP12", stageName: "四号站台", operators: ["蕾缪安"], mode: "单人+挂机", title: "vec-sp12蕾缪安单人一键挂机流", url: "https://www.bilibili.com/video/BV1uy", bvid: "BV1uy" }),
      bili({ displayCode: "VEC-SP12", stageName: "四号站台", operators: ["玛恩纳", "流明"], mode: "单人", title: "玛恩纳流明3技能", url: "https://www.bilibili.com/video/BV1C2Hi6AEHc?p=1", bvid: "BV1C2Hi6AEHc", page: 1, collection: "『矢量突破』VEC-SP12 四号站台" }),
    ],
  },
];
const sub = (o = {}) => ({
  removed: "凯尔希", replacement: "闪灵", stage: "VEC-C", evidence: "闪灵可以替凯尔希，练度够就行",
  source: "comment", kind: "operator_swap", likes: 12, verified: true, ...o,
});
const result = {
  roster: { stage: "VEC-C", videoId: "BV1TEST", page: 2, source: "screenshot",
    slots: [{ operator: "凯尔希", isKey: true }, { operator: "能天使", support: true }, { operator: "银灰" }, { operator: "史尔特尔" }, { operator: "令" }, { operator: "泥岩" }] },
  substitutions: [sub()],
  recommendations: [
    { original: { operator: "凯尔希", isKey: true }, finalOperator: "闪灵", status: "substituted", kind: "operator_swap", via: sub(), alternatives: [sub({ replacement: "夜莺" })], risk: "medium", evidenceUrl: "", note: "关键位替换，注意保全" },
    { original: { operator: "能天使" }, finalOperator: "能天使", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "银灰" }, finalOperator: "银灰", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "史尔特尔" }, finalOperator: "史尔特尔", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "令" }, finalOperator: null, status: "unresolved", via: null, alternatives: [sub({ removed: "令", replacement: "余" })], risk: "high", evidenceUrl: "", note: "未找到可靠替代，建议回评论区确认" },
    { original: { operator: "泥岩" }, finalOperator: "泥岩", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
  ],
  videoTitle: "【全力以赴】VEC-C 矢量突破#3 拟生态 挂机攻略",
  stage: "VEC-C（全力以赴）", bvid: "BV1TEST", stageCode: "VEC-C", dispatchGuides: pools,
  dispatchGuideNote: "B站挖掘：3 关 · 命中 12 条 ｜ 去重 3 条（与 MAA 同阵容）、过滤 158 条（合集或其它关卡）、忽略 7 条（超出 180 天）",
  dispatchGuideEvidence: {
    "VEC-SP02": "P1 网格第 5 格，格内读到「催化装备」",
    "VEC-SP07": "P1 网格第 7 格，格内读到「缴械装备」",
    "VEC-SP12": "P1 网格第 12 格，格内读到「净血装备」",
  },
  stats: { danmakuTotal: 320, commentCandidates: 42, danmakuCandidates: 18 },
};
const lockedOps = { 凯尔希: "VEC-SP02（心中热火）", 能天使: "VEC-SP02（心中热火）", 泥岩: "VEC-SP02（心中热火）" };
const picks = {
  "VEC-SP02": { key: "maa:105144", label: "VEC-SP02（心中热火）", ops: ["凯尔希", "能天使"] },
  "VEC-SP07": { key: "bili:BV1zz", label: "VEC-SP07（荒废矿道）", ops: ["令"] },
};
const hasOp = (n) => !["银灰", "史尔特尔"].includes(n);

const sections = m.renderResultSections(result, hasOp, lockedOps, {
  stageKind: "target",
  picks,
  hideUnavailable: true,
  maxSchemeRows: 12,
  colorBySource: true,
  showGuidesHeading: false,
  showSlotsHeading: false,
  plainIcons: true,
  guideEvidence: result.dispatchGuideEvidence,
});

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const guides = result.dispatchGuides;
const pickedN = guides.filter((p) => picks[p.displayCode.toUpperCase()]).length;

/** 按 id 注入内容（只替换该元素的首段文本/子节点，保持标签自身属性不变） */
const fill = (html, id, content) => {
  const re = new RegExp(`(<[^>]*\\bid="${id}"[^>]*>)([\\s\\S]*?)(</[a-zA-Z]+>)`);
  return re.test(html) ? html.replace(re, (_m, open, _old, close) => `${open}${content}${close}`) : html;
};

let page = readFileSync(join(root, "src/result/index.html"), "utf8");
page = fill(page, "stageName", esc(result.stage));
page = fill(page, "poolCount", `${guides.length} 关 · ${guides.reduce((n, p) => n + p.schemes.length, 0)} 套`);
page = fill(page, "slotCount", `${result.recommendations.length} 槽位`);
page = fill(page, "context", sections.intro);
page = fill(page, "col-pool", sections.guides);
page = fill(page, "col-main", sections.slots);
page = fill(page, "col-side", sections.overview + sections.guides);
page = fill(page, "locks", m.renderLockedSection(lockedOps, true));
page = fill(page, "lockCount", `${Object.keys(lockedOps).length} 人`);
page = fill(
  page,
  "chips",
  [
    `阵容 ${result.roster.slots.length} 人`,
    `替换 ${result.recommendations.filter((x) => x.status === "substituted").length} 处`,
    `无解 ${result.recommendations.filter((x) => x.status === "unresolved").length} 处`,
    `前置关 ${pickedN}/${guides.length} 已选`,
    `占用 ${Object.keys(lockedOps).length} 人`,
  ]
    .map((c) => `<span class="chip">${esc(c)}</span>`)
    .join(" "),
);
page = fill(page, "kpis", "");
page = fill(page, "headline", esc(`${result.stage} ｜ ${result.videoTitle}`));

mkdirSync(join(root, "temp"), { recursive: true });
writeFileSync(join(root, "temp/preview-result.html"), page);
console.log("预览已生成：temp/preview-result.html");
