/**
 * v4.2 缺陷修复离线验收：
 *   1. 目标关/派遣关分流与手动覆盖
 *   2. 文本显式码 → 关卡库通名 → 截图网格位置的编号解析优先级
 *   3. 网格位置与通名冲突时位置胜出，并保留核实提示
 */

import * as esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outfile = join(mkdtempSync(join(tmpdir(), "v2t-stage-")), "stage.mjs");

await esbuild.build({
  stdin: {
    contents: `
      export * from "../src/shared/stageKind.ts";
      export * from "../src/shared/stageResolver.ts";
      export * from "../src/shared/render.ts";
    `,
    resolveDir: join(root, "scripts"),
    sourcefile: "stage-selftest-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node18",
  outfile,
  logLevel: "error",
});

const stage = await import(pathToFileURL(outfile).href);

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const levels = [
  { displayCode: "VEC-SP01", stageId: "act3break_sp01", name: "前沿阵地", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP02", stageId: "act3break_sp02", name: "校验关卡二", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP03", stageId: "act3break_sp03", name: "荒废矿道", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP04", stageId: "act3break_sp04", name: "校验关卡四", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP05", stageId: "act3break_sp05", name: "校验关卡五", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP06", stageId: "act3break_sp06", name: "校验关卡六", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP07", stageId: "act3break_sp07", name: "投资回报", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP08", stageId: "act3break_sp08", name: "校验关卡八", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP09", stageId: "act3break_sp09", name: "校验关卡九", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP10", stageId: "act3break_sp10", name: "校验关卡十", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP11", stageId: "act3break_sp11", name: "校验关卡十一", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP12", stageId: "act3break_sp12", name: "校验关卡十二", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-C", stageId: "act3break_c", name: "全力以赴", eventName: "矢量突破#3 拟生态" },
];

// ---------- 缺陷 1：关卡类型分流 ----------
check("VEC-C 判定为目标关", stage.classifyStage("VEC-C", "【全力以赴】VEC-C") === "target");
check("全力以赴判定为目标关", stage.classifyStage("P2 当前关", "全力以赴 VEC-C") === "target");
check("核心突破判定为目标关", stage.classifyStage("核心突破", "") === "target");
check("VEC-SP07 判定为派遣关", stage.classifyStage("VEC-SP07", "VEC-C 推图合集") === "dispatch");
check("标题只写 VEC-SP 也判定为派遣关", stage.classifyStage("P1", "特别战线 VEC-SP") === "dispatch");
check("stage 优先于视频合集标题", stage.classifyStage("VEC-SP07", "【全力以赴】VEC-C") === "dispatch");
check("特别战线判定为派遣关", stage.classifyStage("P1", "特别战线 派遣记录") === "dispatch");
check("驻防判定为派遣关", stage.classifyStage("驻防", "") === "dispatch");
check("无法判断返回 unknown", stage.classifyStage("P1 阵容", "明日方舟攻略") === "unknown");
check("只有派遣关显示加入按钮", stage.shouldShowDispatchAction("dispatch") && !stage.shouldShowDispatchAction("target"));
check(
  "多黄格无法唯一确定时不显示加入按钮",
  !stage.shouldShowDispatchAction("dispatch", true),
);

const overrideKey = stage.stageKindOverrideKey("P1 阵容", "明日方舟攻略");
const overridden = stage.resolveStageKind("P1 阵容", "明日方舟攻略", {
  [overrideKey]: { kind: "dispatch", updatedAt: 1 },
});
check("未知关卡可手动覆盖为派遣关", overridden.kind === "dispatch" && overridden.source === "override");

// ---------- 缺陷 2：编号识别优先级 ----------
const explicit = stage.resolveStageFromText("VEC-SP07 投资回报", "", "", levels);
check(
  "文本显式码优先",
  explicit.source === "text_code" && explicit.displayCode === "VEC-SP07",
  `${explicit.source}/${explicit.displayCode}`,
);

const byName = stage.resolveStageFromText("P1 攻略", "投资回报 单人", "", levels);
check(
  "无显式码时按关卡库通名反查",
  byName.source === "level_name" && byName.displayCode === "VEC-SP07",
  `${byName.source}/${byName.displayCode}`,
);

const dispatchStages = levels.filter((l) => /_sp\d+$/i.test(l.stageId));
const gridChecks = [
  [1, "前沿阵地", "VEC-SP01"],
  [3, "荒废矿道", "VEC-SP03"],
  [7, "投资回报", "VEC-SP07"],
];
for (const [position, name, code] of gridChecks) {
  const hit = stage.codeFromGridPosition(position, dispatchStages);
  check(`网格第 ${position} 格 ↔ 通名「${name}」`, hit?.displayCode === code && hit?.name === name, hit?.displayCode);
}

const grid = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { gridPosition: 7, gridName: "投资回报" },
  levels,
);
check(
  "网格位置推算编号",
  grid.source === "grid" && grid.displayCode === "VEC-SP07" && !grid.needsVerification,
  `${grid.displayCode}/${grid.gridName}`,
);

const conflict = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { gridPosition: 1, gridName: "投资回报" },
  levels,
);
check(
  "网格通名冲突时位置规则胜出",
  conflict.displayCode === "VEC-SP01" && conflict.needsVerification === true,
  conflict.displayCode,
);
check("冲突结果带核实提示", /请核实/.test(conflict.note ?? ""), conflict.note);

const rowColumn = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { gridRow: 2, gridColumn: 3, gridColumns: 4, gridName: "投资回报" },
  levels,
);
check(
  "行列按从上到下、从左到右换算编号",
  rowColumn.gridPosition === 7 && rowColumn.displayCode === "VEC-SP07" && rowColumn.source === "grid",
  `${rowColumn.gridPosition}/${rowColumn.source}`,
);

const multiGrid = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  {
    gridColumns: 4,
    gridCells: [
      { row: 1, column: 2 },
      { row: 2, column: 1 },
      { row: 2, column: 2 },
      { row: 2, column: 3 },
      { row: 3, column: 2 },
      { row: 3, column: 4 },
    ],
  },
  levels,
);
check(
  "多个黄色格全部按行列映射",
  multiGrid.source === "unknown" &&
    multiGrid.gridCandidates?.map((candidate) => candidate.displayCode).join(",") ===
      "VEC-SP02,VEC-SP05,VEC-SP06,VEC-SP07,VEC-SP10,VEC-SP12",
  multiGrid.gridCandidates?.map((candidate) => candidate.displayCode).join(","),
);
check("多黄格无法唯一确定当前关时不猜测", /无法唯一定位当前关/.test(multiGrid.note ?? ""), multiGrid.note);
check(
  "多黄格解析被识别为歧义",
  stage.isAmbiguousStageResolution(multiGrid),
);

const currentCellWins = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  {
    gridPosition: 3,
    gridName: "荒废矿道",
    gridCells: [
      { row: 1, column: 1 },
      { row: 1, column: 2 },
    ],
  },
  levels,
);
check(
  "当前高亮格优先于多黄格列表用于当前关",
  currentCellWins.source === "grid" && currentCellWins.displayCode === "VEC-SP03",
  `${currentCellWins.source}/${currentCellWins.displayCode}`,
);

const hintName = stage.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { matchedName: "投资回报" },
  levels,
);
check(
  "画面 OCR 通名可反查",
  hintName.source === "level_name" && hintName.displayCode === "VEC-SP07",
  `${hintName.source}/${hintName.displayCode}`,
);

// ---------- P1 派遣格识别与 P2 当前关并行 ----------
const p1Vision = {
  explicitCode: "VEC-C",
  gridColumns: 4,
  gridCells: [
    { row: 1, column: 2 },
    { row: 2, column: 1 },
    { row: 2, column: 2 },
    { row: 2, column: 3 },
    { row: 3, column: 2 },
    { row: 3, column: 4 },
  ],
};
const p2Target = stage.resolveStageWithVision(
  "P2 当前关",
  "【全力以赴】VEC-C",
  "",
  p1Vision,
  levels,
);
check(
  "P2 显式 VEC-C 保持为目标关",
  p2Target.source === "text_code" && p2Target.displayCode === "VEC-C",
  `${p2Target.source}/${p2Target.displayCode}`,
);

const p1Grid = stage.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【全力以赴】VEC-C",
  "",
  p1Vision,
  levels,
);
check(
  "P1 六个黄色格独立映射为 SP 候选",
  p1Grid.candidates.map((candidate) => candidate.displayCode).join(",") ===
    "VEC-SP02,VEC-SP05,VEC-SP06,VEC-SP07,VEC-SP10,VEC-SP12",
  p1Grid.candidates.map((candidate) => candidate.displayCode).join(","),
);

const p1PositionGrid = stage.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【全力以赴】VEC-C",
  "",
  {
    explicitCode: "VEC-C",
    gridCells: [
      { position: 2 },
      { position: 5 },
      { position: 6 },
      { position: 7 },
      { position: 10 },
      { position: 12 },
    ],
  },
  levels,
);
check(
  "P1 直接位置不会按黄格数量重排",
  p1PositionGrid.candidates.map((candidate) => candidate.displayCode).join(",") ===
    "VEC-SP02,VEC-SP05,VEC-SP06,VEC-SP07,VEC-SP10,VEC-SP12",
  p1PositionGrid.candidates.map((candidate) => candidate.displayCode).join(","),
);

const p1GeometryWins = stage.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【全力以赴】VEC-C",
  "",
  {
    explicitCode: "VEC-C",
    gridCells: [{ position: 1, row: 1, column: 2, columns: 4 }],
  },
  levels,
);
check(
  "P1 行列坐标优先于被重排的 position",
  p1GeometryWins.candidates[0]?.displayCode === "VEC-SP02",
  p1GeometryWins.candidates[0]?.displayCode,
);

// ---------- UI 文案 ----------
const result = {
  roster: { stage: "VEC-C", videoId: "BV1", page: 2, slots: [], source: "screenshot" },
  substitutions: [],
  recommendations: [],
  videoTitle: "【全力以赴】VEC-C",
  stage: "VEC-C",
  bvid: "BV1",
};
const targetHtml = stage.renderResult(result, () => false, {}, { stageKind: "target" });
check("目标关标题使用适配结果文案", targetHtml.includes("适配结果（含占用约束）"));
check("目标关显示推进关提示", targetHtml.includes("本关为推进关：结果已避开占用清单中的干员"));
check("目标关不出现手动派遣链接", !targetHtml.includes("这其实是派遣关"));

const dispatchHtml = stage.renderResult(result, () => false, {}, { stageKind: "dispatch" });
check("派遣关标题使用候选方案文案", dispatchHtml.includes("派遣关 · 候选方案"));
check("派遣关不显示推进关提示", !dispatchHtml.includes("本关为推进关"));

const ambiguousHtml = stage.renderResult(result, () => false, {}, {
  stageKind: "dispatch",
  ambiguousDispatch: true,
});
check("多黄格提示先核对关卡编号", ambiguousHtml.includes("未唯一确定当前关前不会写入占用清单"));
check("多黄格不显示手动切换链接", !ambiguousHtml.includes("这其实是派遣关"));

const unknownHtml = stage.renderResult(result, () => false, {}, { stageKind: "unknown" });
check("无法判断默认目标关并提供小链接", unknownHtml.includes("这其实是派遣关 → 当作派遣关"));

const guideResult = {
  ...result,
  dispatchGuides: [{
    displayCode: "VEC-SP02",
    stageId: "act3break_sp02",
    stageName: "校验关卡二",
    counts: { maa: 1, bili: 1 },
    schemes: [
      {
        source: "maa",
        sourceLabel: "MAA作业",
        displayCode: "VEC-SP02",
        stageName: "校验关卡二",
        operators: ["凯尔希"],
        opers: [{ name: "凯尔希", skill: 3 }],
        mode: "单人",
        title: "凯尔希单核",
        details: "",
        author: "测试作业",
        url: "",
        bvid: "",
        views: 100,
        hotScore: 10,
      },
      {
        source: "bili",
        sourceLabel: "B站视频",
        displayCode: "VEC-SP02",
        stageName: "校验关卡二",
        operators: ["能天使"],
        opers: [{ name: "能天使" }],
        mode: "低星",
        title: "低保实战",
        details: "",
        author: "测试UP",
        url: "https://www.bilibili.com/video/BV1TEST",
        bvid: "BV1TEST",
        views: 0,
        hotScore: 0,
      },
    ],
  }],
};
const guideHtml = stage.renderResult(guideResult, () => false);
check("结果展示 P1 派遣关攻略区", guideHtml.includes("P1 派遣关攻略（按黄色格位置识别）"));
check("攻略区展示 SP 编号与 MAA 作业方案", guideHtml.includes("VEC-SP02") && guideHtml.includes("MAA作业"));
check("攻略区展示 B站视频方案与外链", guideHtml.includes("B站视频") && guideHtml.includes("BV1TEST"));

console.log(failures === 0 ? "\n✅ v4.2 缺陷修复验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
