/**
 * v4.3 修复清单离线验收（design-v4 §9）：
 *   9.1 数据源标签改名（MAA作业 / B站视频 + title 悬停说明）
 *   9.2 候选池可点击链接（方案来源 → prts.plus/operation/{id}；B站 → 视频页；关卡标题）
 *   9.3 候选方案勾选 → 占用实时置灰（lockedOps 写入/同关换选/取消恢复/.occupied+🔒）
 *   9.4 空清单引导（推图关结果顶部提示）
 *   9.5 干员名修饰词清洗（prompt 文案 + stripModifiers 兜底，不进昵称纠错队列）
 *   9.6 网格通名 OCR 聚焦（界面标题「特别战线」不再当通名；真实冲突提示保留）
 *
 *   node scripts/v43-selftest.mjs
 */

import * as esbuild from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outfile = join(mkdtempSync(join(tmpdir(), "v2t-v43-")), "v43.mjs");

await esbuild.build({
  stdin: {
    contents: `
      export * from "../src/shared/stageKind.ts";
      export * from "../src/shared/stageResolver.ts";
      export * from "../src/shared/render.ts";
      export * from "../src/shared/dispatchPool.ts";
      export * from "../src/shared/dispatchPicks.ts";
      export * from "../src/shared/dispatchGuides.ts";
      export * from "../src/shared/biliDig.ts";
      export * from "../src/shared/nameClean.ts";
      export * from "../src/shared/operatorDB.ts";
      export * from "../src/shared/roster.ts";
      export * from "../src/shared/miner.ts";
    `,
    resolveDir: join(root, "scripts"),
    sourcefile: "v43-selftest-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node18",
  outfile,
  logLevel: "error",
});

// ---- 离线环境：mock chrome.storage / fetch（本地打包兜底字典 + 拦截远程请求） ----
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (key) => {
        const keys = key == null ? Object.keys(store) : Array.isArray(key) ? key : [key];
        const out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      },
      set: async (obj) => Object.assign(store, obj),
      remove: async () => {},
    },
    session: { get: async () => ({}), set: async () => {} },
  },
  runtime: { getURL: (p) => pathToFileURL(join(root, p)).href },
};
globalThis.fetch = async (url) => {
  const target = String(url);
  if (target.startsWith("file:")) {
    const text = readFileSync(fileURLToPath(target), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text), text: async () => text };
  }
  throw new Error("offline selftest");
};

const v43 = await import(pathToFileURL(outfile).href);

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

// ---------- 公共夹具：一关两个来源的候选池 ----------
const maaScheme = {
  source: "maa",
  sourceLabel: v43.SOURCE_LABELS.maa,
  displayCode: "VEC-SP02",
  stageName: "心中热火",
  operators: ["凯尔希", "能天使"],
  opers: [{ name: "凯尔希", skill: 3 }, { name: "能天使", skill: 2 }],
  mode: "单人",
  title: "凯尔希单核",
  details: "",
  author: "作业作者",
  url: "",
  bvid: "",
  copilotId: 105144,
  views: 28,
  hotScore: 9.6,
};
const biliScheme = {
  source: "bili",
  sourceLabel: v43.SOURCE_LABELS.bili,
  displayCode: "VEC-SP02",
  stageName: "心中热火",
  operators: ["银灰"],
  opers: [{ name: "银灰" }],
  mode: "低星",
  title: "低保实战",
  details: "",
  author: "UP主",
  url: "https://www.bilibili.com/video/BV1TEST",
  bvid: "BV1TEST",
  views: 0,
  hotScore: 0,
};
const guidePool = {
  displayCode: "VEC-SP02",
  stageId: "act3break_sp02",
  stageName: "心中热火",
  schemes: [maaScheme, biliScheme],
  counts: { maa: 5, bili: 2 },
};
const baseResult = {
  roster: { stage: "VEC-C", videoId: "BV1", page: 2, slots: [], source: "screenshot" },
  substitutions: [],
  recommendations: [
    {
      original: { operator: "凯尔希", isKey: true },
      finalOperator: "凯尔希",
      status: "keep",
      via: null,
      alternatives: [
        {
          removed: "凯尔希",
          replacement: "闪灵",
          stage: "VEC-C",
          evidence: "闪灵可以替凯尔希",
          source: "comment",
          kind: "operator_swap",
          likes: 12,
          verified: true,
        },
      ],
      risk: "low",
      evidenceUrl: "",
      note: "",
    },
  ],
  videoTitle: "【全力以赴】VEC-C 攻略",
  stage: "VEC-C",
  bvid: "BV1",
  dispatchGuides: [guidePool],
};
const hasAll = () => true;

console.log("\n== §9.1 数据源标签改名 ==");
const guideHtml = v43.renderResult(baseResult, hasAll, {}, { stageKind: "target" });
check("候选池计数使用「MAA作业 / B站视频」", guideHtml.includes("MAA作业 5") && guideHtml.includes("B站视频 2"));
// 「结构化」仅允许出现在 MAA 悬停说明（§9.1 指定文案），不能再作为计数前缀
check(
  "旧计数前缀「结构化 N / 实战 N」不再出现",
  !/结构化\s*\d/.test(guideHtml) && !guideHtml.includes("实战视频") && !/实战\s*\d/.test(guideHtml),
);
check(
  "计数带 title 悬停说明",
  guideHtml.includes("MAA 作业站（prts.plus）的结构化方案") && guideHtml.includes("B站攻略视频挖掘"),
);
check("方案前缀标签同步改名", guideHtml.includes(">MAA作业</a>") && guideHtml.includes(">B站视频</a>"));

console.log("\n== §9.2 可点击链接 ==");
check("工具函数：作业页链接", v43.maaOperationUrl(105144) === "https://prts.plus/operation/105144");
check("工具函数：无 id 退回作业站首页", v43.maaOperationUrl() === "https://prts.plus/");
check("工具函数：B站视频链接", v43.biliVideoUrl("BV1TEST") === "https://www.bilibili.com/video/BV1TEST");
check("MAA 方案来源指向作业页", guideHtml.includes('href="https://prts.plus/operation/105144"'));
check("B站方案来源指向视频页", guideHtml.includes('href="https://www.bilibili.com/video/BV1TEST"'));
check("来源链接新标签打开", (guideHtml.match(/target="_blank"/g) ?? []).length >= 3);
check(
  "关卡标题可点击（作业站该关列表）",
  guideHtml.includes('href="https://prts.plus/"') && guideHtml.includes(">VEC-SP02</a>"),
);

console.log("\n== §9.3 候选方案勾选 → 占用实时置灰 ==");
check("候选方案带勾选框", guideHtml.includes('data-pick="1"') && guideHtml.includes('data-stage="VEC-SP02"'));
check("MAA 方案勾选标识含作业 id", guideHtml.includes('data-scheme="maa:105144"'));
check("B站方案勾选标识含 bvid", guideHtml.includes('data-scheme="bili:BV1TEST"'));
check("默认未勾选", !guideHtml.includes("checked "));

const picked1 = v43.togglePick({}, {}, {
  stageCode: "VEC-SP02",
  stageName: "心中热火",
  key: "maa:105144",
  ops: maaScheme.operators,
});
check("勾选写入 lockedOps（干员 → 关卡标签）", picked1.checked === true);
check(
  "占用标签含显示码与关名",
  picked1.lockedOps["凯尔希"] === "VEC-SP02（心中热火）" && picked1.lockedOps["能天使"] === "VEC-SP02（心中热火）",
  JSON.stringify(picked1.lockedOps),
);
check("勾选态被记录（用于恢复与换选）", picked1.picks["VEC-SP02"]?.key === "maa:105144");

const pickedHtml = v43.renderResult(baseResult, hasAll, picked1.lockedOps, {
  stageKind: "target",
  picks: picked1.picks,
});
/** 只取候选池区块（「P1 派遣关攻略」→「实战替代建议」之间），避免把下方推荐结果算进来 */
const poolSection = (html) => (html.split("P1 派遣关攻略")[1] ?? "").split("实战替代建议")[0] ?? "";
check("已勾选方案显示 checked", /data-scheme="maa:105144" checked/.test(pickedHtml));
check("结果区被占干员变灰+删除线", pickedHtml.includes('class="occupied"') && pickedHtml.includes("text-decoration:line-through"));
check("被占干员带 🔒 徽章", /occupied[^<]*>[^<]*<\/span><span class="lockbadge"[^>]*>🔒/.test(pickedHtml));
check("候选池内本关自己锁的干员不置灰", !/occupied[^<]*>凯尔希<\/span>/.test(poolSection(pickedHtml)));

const sharedLocked = { 能天使: "VEC-SP05（校验关卡五）", 银灰: "VEC-SP05（校验关卡五）" };
const crossed = v43.renderResult(baseResult, hasAll, sharedLocked, { stageKind: "target" });
check("被其它关占用的方案干员同样置灰", /occupied[^<]*>银灰<\/span>/.test(poolSection(crossed)));

const switched = v43.togglePick(picked1.lockedOps, picked1.picks, {
  stageCode: "VEC-SP02",
  stageName: "心中热火",
  key: "bili:BV1TEST",
  ops: biliScheme.operators,
});
check("同关勾选新方案自动移除旧方案干员", !("凯尔希" in switched.lockedOps) && switched.lockedOps["银灰"] === "VEC-SP02（心中热火）");
check("同关只保留一条勾选", Object.keys(switched.picks).length === 1 && switched.picks["VEC-SP02"].key === "bili:BV1TEST");

const unchecked = v43.togglePick(switched.lockedOps, switched.picks, {
  stageCode: "VEC-SP02",
  stageName: "心中热火",
  key: "bili:BV1TEST",
  ops: biliScheme.operators,
});
check("取消勾选移出 lockedOps", unchecked.checked === false && Object.keys(unchecked.lockedOps).length === 0);
check("取消勾选清空该关勾选态", Object.keys(unchecked.picks).length === 0);
const restoredHtml = v43.renderResult(baseResult, hasAll, unchecked.lockedOps, { stageKind: "target" });
check("取消后颜色立即恢复（无 .occupied）", !restoredHtml.includes('class="occupied"'));

const sharedPick = v43.togglePick(
  { 能天使: "VEC-SP02（心中热火）", 凯尔希: "VEC-SP02（心中热火）" },
  { "VEC-SP02": { key: "maa:105144", label: "VEC-SP02（心中热火）", ops: ["凯尔希", "能天使"] } },
  { stageCode: "VEC-SP05", stageName: "校验关卡五", key: "maa:999", ops: ["能天使", "银灰"] },
);
check(
  "跨关共用干员改挂最新勾选关，原关独占干员保留",
  sharedPick.lockedOps["能天使"] === "VEC-SP05（校验关卡五）" &&
    sharedPick.lockedOps["银灰"] === "VEC-SP05（校验关卡五）" &&
    sharedPick.lockedOps["凯尔希"] === "VEC-SP02（心中热火）",
  JSON.stringify(sharedPick.lockedOps),
);
const sharedRelease = v43.togglePick(sharedPick.lockedOps, sharedPick.picks, {
  stageCode: "VEC-SP05",
  stageName: "校验关卡五",
  key: "maa:999",
  ops: ["能天使", "银灰"],
});
check(
  "取消后共用干员回到仍在勾选的关",
  sharedRelease.lockedOps["能天使"] === "VEC-SP02（心中热火）" &&
    !("银灰" in sharedRelease.lockedOps) &&
    sharedRelease.lockedOps["凯尔希"] === "VEC-SP02（心中热火）",
  JSON.stringify(sharedRelease.lockedOps),
);

const manualLock = v43.renderResult(baseResult, hasAll, { 凯尔希: "手动关" }, { stageKind: "target" });
check("替代建议里被占候选置灰", /occupied[^<]*>凯尔希<\/span>/.test(manualLock));

console.log("\n== §9.4 空清单引导 ==");
check("推图关空清单显示实时置灰引导", guideHtml.includes("勾选任意派遣关方案后，被占用干员将在此"));
check("引导写明无需重新分析", guideHtml.includes("无需重新分析"));
const withLocksHtml = v43.renderResult(baseResult, hasAll, { 凯尔希: "VEC-SP02（心中热火）" }, { stageKind: "target" });
check("清单非空时不再提示", !withLocksHtml.includes("勾选任意派遣关方案后"));
const dispatchHtml = v43.renderResult(baseResult, hasAll, {}, { stageKind: "dispatch" });
check("派遣关结果不提示（该处就是候选池）", !dispatchHtml.includes("勾选任意派遣关方案后"));
const noSchemeHtml = v43.renderResult(
  { ...baseResult, dispatchGuides: [{ ...guidePool, schemes: [] }] },
  hasAll,
  {},
  { stageKind: "target" },
);
check("没有可勾选方案时不提示", !noSchemeHtml.includes("勾选任意派遣关方案后"));

console.log("\n== §9.5 干员名修饰词清洗 ==");
check("stripModifiers：高练机械师 → 机械师", v43.stripModifiers("高练机械师") === "机械师");
check("stripModifiers：塞雷娅满练 → 塞雷娅", v43.stripModifiers("塞雷娅满练") === "塞雷娅");
check("stripModifiers：机械师（专三）→ 机械师", v43.stripModifiers("机械师（专三）") === "机械师");
check("stripModifiers：3级模组机械师 → 机械师", v43.stripModifiers("3级模组机械师") === "机械师");
check("stripModifiers：满练专三机械师 → 机械师", v43.stripModifiers("满练专三机械师") === "机械师");
check("stripModifiers 不误伤真名（小满）", v43.stripModifiers("小满") === "小满");
check("stripModifiers 不动干净名字", v43.stripModifiers("机械师") === "机械师");

const db = await v43.OperatorDB.load();
check("字典可用（离线打包兜底）", db.exists("机械师"));
check("resolve：高练机械师 → 机械师", db.resolve("高练机械师") === "机械师");
check("exists：高练机械师 视为已识别", db.exists("高练机械师") === true);
check("resolve：满配塞雷娅 → 塞雷娅", db.resolve("满配塞雷娅") === "塞雷娅");

const meta = { video: { bvid: "BV1", title: "t", desc: "", pages: [], aid: 1, cid: 1 }, page: 2, stage: "VEC-C", cid: 1 };
const unknown = [];
const roster = v43.parseRosterReply(
  JSON.stringify({ operators: [{ name: "高练机械师" }, { name: "满配塞雷娅" }] }),
  meta,
  db,
  (n) => unknown.push(n),
);
check(
  "阵容提取：清洗后正常入库",
  roster.slots.map((s) => s.operator).join(",") === "机械师,塞雷娅",
  roster.slots.map((s) => s.operator).join(","),
);
await new Promise((r) => setTimeout(r, 50)); // recordUnknownName 为 fire-and-forget，等一拍再看存储
check("清洗命中不进待确认队列", !store.corrections_pending?.["高练机械师"] && unknown.length === 0);

let threw = false;
try {
  v43.parseRosterReply(JSON.stringify({ operators: [{ name: "不存在的外星人" }] }), meta, db);
} catch {
  threw = true;
}
await new Promise((r) => setTimeout(r, 50));
check("真·未知名仍然报错/入库（兜底不吞问题）", threw && !!store.corrections_pending?.["不存在的外星人"]);

const rosterPrompt = v43.buildRosterPromptText(meta, "");
check("提取 prompt 明确剥离修饰词", rosterPrompt.includes("练度") && rosterPrompt.includes("高练机械师"));
const { messages: combined } = v43.buildWebCombinedMessages("VEC-C", rosterPrompt, [], [], []);
const combinedText = JSON.stringify(combined);
check("挖掘/合并 prompt 也要求剥离修饰词（replacement）", combinedText.includes("练度修饰词不属于名字"));

console.log("\n== §9.6 网格通名 OCR 聚焦 ==");
const levels = [
  { displayCode: "VEC-SP01", stageId: "act3break_sp01", name: "前沿阵地", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP02", stageId: "act3break_sp02", name: "心中热火", eventName: "矢量突破#3 拟生态" },
  { displayCode: "VEC-SP07", stageId: "act3break_sp07", name: "投资回报", eventName: "矢量突破#3 拟生态" },
];
const uiTitle = v43.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { gridPosition: 1, gridName: "特别战线" },
  levels,
);
check(
  "界面标题不再当通名（按位置采用）",
  uiTitle.displayCode === "VEC-SP01" && uiTitle.source === "grid" && uiTitle.gridName === undefined,
  `${uiTitle.displayCode}/${uiTitle.gridName}`,
);
check("界面标题不再误报通名冲突", !uiTitle.needsVerification && !/不一致/.test(uiTitle.note ?? ""), uiTitle.note);

const uiMatched = v43.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { matchedName: "特别战线", gridPosition: 2 },
  levels,
);
check(
  "matchedName 为界面标题时回退网格位置",
  uiMatched.source === "grid" && uiMatched.displayCode === "VEC-SP02",
  `${uiMatched.source}/${uiMatched.displayCode}`,
);

const gridWithTitle = v43.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【全力以赴】VEC-C",
  "",
  { explicitCode: "VEC-C", gridCells: [{ position: 2, name: "特别战线" }, { position: 3, name: "投资回报" }] },
  levels,
);
check(
  "多黄格：标题被过滤、真通名保留",
  gridWithTitle.candidates.length === 2 &&
    gridWithTitle.candidates[0].needsVerification === undefined &&
    gridWithTitle.candidates[1].needsVerification === undefined,
  JSON.stringify(gridWithTitle.candidates.map((c) => [c.displayCode, c.gridName, c.needsVerification])),
);

const realConflict = v43.resolveStageWithVision(
  "P1 特别战线",
  "矢量突破#3 拟生态",
  "",
  { gridPosition: 1, gridName: "投资回报" },
  levels,
);
check(
  "格内名称与位置冲突时按名称采用（位置读数实测不可靠）",
  realConflict.displayCode === "VEC-SP07" && realConflict.needsVerification === true && /按名称采用/.test(realConflict.note ?? ""),
  `${realConflict.displayCode}｜${realConflict.note}`,
);

console.log("\n== 二次实测修复：补给界面网格 / B站合集归属 ==");
// 用户实测截图：P1 黄格内是补给名（催化装备…），不是关卡名 → 不得按位置硬猜关卡
const supplyGrid = v43.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【矢量突破#3】拟生态",
  "",
  {
    explicitCode: "VEC-C",
    gridColumns: 4,
    gridCells: [
      { row: 2, column: 1, name: "催化装备" },
      { row: 2, column: 3, name: "缴械装备" },
      { row: 3, column: 4, name: "净血装备" },
    ],
  },
  levels,
);
check("补给/配置界面不产出派遣候选", supplyGrid.candidates.length === 0, JSON.stringify(supplyGrid.candidates));
check(
  "并说明原因（名称不属于本活动关卡）",
  /不属于本活动任何关卡/.test(supplyGrid.note ?? "") && /催化装备/.test(supplyGrid.note ?? ""),
  supplyGrid.note,
);
// 名称能匹配时以名称为准（位置读数偏差被纠正）
const namedGrid = v43.resolveDispatchGridFromVision(
  "P1 特别战线",
  "【矢量突破#3】拟生态",
  "",
  {
    gridCells: [
      { position: 1, name: "投资回报" }, // 位置推算=SP01（前沿阵地），名称=SP07
      { position: 3, name: "心中热火" }, // 位置推算=SP07（投资回报），名称=SP02
    ],
  },
  levels,
);
check(
  "格内名称优先于位置推算",
  namedGrid.candidates.map((c) => c.displayCode).join(",") === "VEC-SP07,VEC-SP02",
  namedGrid.candidates.map((c) => c.displayCode).join(","),
);
check(
  "名称与位置不一致时给出核实提示",
  /已按名称采用/.test(namedGrid.note ?? "") && namedGrid.candidates.every((c) => c.needsVerification),
  namedGrid.note,
);

// B站语料关卡归属
check("提取多个关卡码", v43.extractStageCodes("核心突破/特别战线 全力以赴 VEC-ABCD").length >= 1);
check(
  "识别区间/合集标题",
  v43.isMultiStageText("【特别战线】攻略合集VEC-SP-01~16 简单好抄 单人/单核") &&
    v43.isMultiStageText("【矢量突破#3】拟生态全关卡 摆完挂机 核心突破/特别战线/全力以赴") &&
    !v43.isMultiStageText("VEC-SP12 蕾缪安二技能 单人"),
);
check(
  "合集/区间大标题不算本关方案（无法归属单关）",
  v43.matchStageText("【特别战线】攻略合集VEC-SP-01~16 简单好抄", { code: "VEC-SP12", name: "四号站台" }) === "unknown" &&
    v43.matchStageText("【矢量突破#3】拟生态全关卡 VEC-ABCD", { code: "VEC-SP12" }) === "unknown",
);
check(
  "分P 标题按关卡码归属",
  v43.matchStageText("VEC-SP12（蕾缪安二技能）", { code: "VEC-SP12" }) === "target" &&
    v43.matchStageText("VEC-SP12（蕾缪安二技能）", { code: "VEC-SP16" }) === "other",
);
check(
  "裸写兄弟关号也算关卡引用（VEC-SP05 SP06 SP07…）",
  v43.extractStageCodes("VEC-SP05 SP06 SP07 SP13 SP14 难以相交").length === 5 &&
    v43.matchStageText("VEC-SP05 SP06 SP07 SP13 SP14 难以相交", { code: "VEC-SP05" }) === "unknown",
);
check(
  "合集分P 序号兜底归属（05缴械装备 令 → VEC-SP05）",
  v43.partNumberMatches("05缴械装备 令", "VEC-SP05") &&
    v43.partNumberMatches("12净血装备 莱伊", "VEC-SP12") &&
    !v43.partNumberMatches("05缴械装备 令", "VEC-SP07") &&
    !v43.partNumberMatches("15缴械装备 令", "VEC-SP05") &&
    // 带显示码的分P 由 matchStageText 处理，不走序号兜底
    !v43.partNumberMatches("VEC-SP12 单人", "VEC-SP12"),
);
check(
  "序号兜底只在关卡清单类视频里生效",
  v43.looksLikeStageList("VEC-SP01~14 矢量突破#3 特别战线合集") &&
    v43.looksLikeStageList("【特别战线】攻略合集VEC-SP-01~16") &&
    !v43.looksLikeStageList("明日方舟 4-4 随便打打"),
);
check(
  "无码标题按关卡名归属",
  v43.matchStageText("特别战线 SP16 最终愿望 挂机", { code: "VEC-SP16", name: "最终愿望" }) === "target" &&
    v43.matchStageText("特别战线 荒废矿道 挂机", { code: "VEC-SP16", name: "最终愿望" }) === "unknown",
);
check(
  "分P 方案带 ?p= 直达链接与分P 标注",
  (() => {
    const withPart = {
      ...biliScheme,
      page: 12,
      collection: "【特别战线】攻略合集VEC-SP-01~16",
      title: "VEC-SP12（蕾缪安二技能）",
      url: "https://www.bilibili.com/video/BV1TEST?p=12",
    };
    const html = v43.renderResult(
      { ...baseResult, dispatchGuides: [{ ...guidePool, schemes: [withPart] }] },
      hasAll,
      {},
      { stageKind: "target" },
    );
    return (
      html.includes('href="https://www.bilibili.com/video/BV1TEST?p=12"') &&
      html.includes("VEC-SP12（蕾缪安二技能）") &&
      html.includes("分P12页↗") &&
      html.includes("合集：【特别战线】攻略合集VEC-SP-01~16（P12）")
    );
  })(),
);

const schemaText = JSON.stringify(v43.buildWebCombinedMessages("VEC-C", "roster", [], [], []).messages);
check(
  "prompt 要求只读黄格内部名称区域",
  schemaText.includes("黄色格内部") && schemaText.includes("特别战线"),
);

console.log("\n== q1 B站挖掘：默认全关 + 范围/页数可配 ==");
const minePools = [
  { displayCode: "VEC-SP01", schemes: [{}, {}, {}] }, // MAA 方案充足
  { displayCode: "VEC-SP02", schemes: [{}] }, // MAA 方案薄
  { displayCode: "VEC-SP03", schemes: [] }, // MAA 无方案
  { displayCode: "VEC-SP04", schemes: [{}, {}] },
];
check(
  "默认（scope=all）全部候选关都挖",
  v43.selectBiliTargets(minePools, { scope: "all" }).map((t) => t.displayCode).join(",") ===
    "VEC-SP01,VEC-SP02,VEC-SP03,VEC-SP04",
);
check(
  "scope=thin 仅挖 MAA 方案不足的关（旧行为）",
  v43.selectBiliTargets(minePools, { scope: "thin", thinThreshold: 2 })
    .map((t) => t.displayCode)
    .join(",") === "VEC-SP02,VEC-SP03",
);
check("scope=off 不挖", v43.selectBiliTargets(minePools, { scope: "off" }).length === 0);
check(
  "maxStages 截断挖掘关数（不影响展示）",
  v43.selectBiliTargets(minePools, { scope: "all", maxStages: 2 })
    .map((t) => t.displayCode)
    .join(",") === "VEC-SP01,VEC-SP02",
);

const noteStats = {
  biliScope: "all",
  biliPages: 2,
  biliMaxAgeDays: 180,
  biliMined: 4,
  biliCached: 3,
  biliFailed: 1,
  biliHits: 9,
  biliShown: 6,
  biliSkipped: 5,
  biliExpired: 7,
};
const note = v43.biliMiningNote(noteStats);
check("结果区展示挖掘关数与命中条数", note.includes("B站挖掘：4 关 · 命中 9 条"), note);
check("标注缓存命中关数", note.includes("缓存 3 关"));
check("标注搜索失败关数", note.includes("1 关搜索失败"));
check("标注与 MAA 同阵容的去重条数", note.includes("3 条与 MAA 方案同阵容已去重"));
check("标注被排除的合集/他关语料条数", note.includes("已排除 5 条合集/他关语料"));
check("标注被排除的过期视频条数", note.includes("已排除 7 条180 天外的旧视频"), note);
check(
  "发布时间窗口判定（半年内 / 不限）",
  v43.withinMaxAge(Date.now() / 1000 - 10 * 86400, Date.now(), 180) &&
    !v43.withinMaxAge(Date.now() / 1000 - 504 * 86400, Date.now(), 180) &&
    v43.withinMaxAge(Date.now() / 1000 - 504 * 86400, Date.now(), 0) &&
    v43.withinMaxAge(0, Date.now(), 180),
);
check("关闭挖掘时不出现该行", v43.biliMiningNote({ ...noteStats, biliScope: "off" }) === "");
check(
  "没有挖掘行为时不出现该行",
  v43.biliMiningNote({ ...noteStats, biliMined: 0, biliFailed: 0, biliHits: 0, biliCached: 0 }) === "",
);

console.log("\n== q1 候选池展示：按来源配额（B站不再被 MAA 挤掉） ==");
const manySchemes = [
  ...Array.from({ length: 6 }, (_, i) => ({ source: "maa", tag: `M${i}` })),
  ...Array.from({ length: 8 }, (_, i) => ({ source: "bili", tag: `B${i}` })),
];
const visible = v43.pickVisibleSchemes(manySchemes);
check(
  "默认展示 6 条 = MAA 3 + B站 3",
  visible.shown.length === 6 &&
    visible.shown.filter((s) => s.source === "maa").length === 3 &&
    visible.shown.filter((s) => s.source === "bili").length === 3,
  visible.shown.map((s) => s.tag).join(","),
);
check("保持池内顺序（不重排热度/挖掘序）", visible.shown.map((s) => s.tag).join(",") === "M0,M1,M2,B0,B1,B2");
check("统计未展示条数用于提示", visible.hidden === 8);
const biliOnly = v43.pickVisibleSchemes(Array.from({ length: 4 }, (_, i) => ({ source: "bili", tag: `B${i}` })));
check(
  "某来源不足时由另一来源补齐",
  biliOnly.shown.length === 4 && biliOnly.hidden === 0,
  biliOnly.shown.map((s) => s.tag).join(","),
);
const poolHtml = v43.renderResult(
  {
    ...baseResult,
    dispatchGuides: [{ ...guidePool, schemes: [...guidePool.schemes, ...Array.from({ length: 5 }, (_, i) => ({
      ...biliScheme,
      bvid: `BV${i}`,
      url: `https://www.bilibili.com/video/BV${i}`,
      operators: [`低星干员${i}`],
      opers: [{ name: `低星干员${i}` }],
    }))] }],
  },
  hasAll,
  {},
  { stageKind: "target" },
);
check("渲染含「另有 N 条方案未展示」提示", /另有 \d+ 条方案未展示/.test(poolHtml));
check("MAA 与 B站 方案同屏可见", poolHtml.includes("MAA作业") && poolHtml.includes("bili:BV0"));

console.log("\n== q4 结果可读性：总览块 + 分区标题 ==");
check("总览块：本关用这套（含人数与干员）", guideHtml.includes("🎯 本关用这套（1 人）") && guideHtml.includes("凯尔希"));
check("总览块：未勾选时提示去候选池勾选", guideHtml.includes("🚩 前置关（派遣占用）") && guideHtml.includes("⬜ 未选 → 在下方候选池勾选"));
check("总览块：勾选后显示该关已选方案", pickedHtml.includes("✅") && pickedHtml.includes("凯尔希·能天使"));
check(
  "被占用干员在总览里也置灰",
  /occupied[^<]*>凯尔希<\/span>/.test(pickedHtml.split("🚩 P1 派遣关攻略")[0] ?? ""),
);
check(
  "总览块：冲突统计（替换/无解）",
  (() => {
    const withConflicts = v43.renderResult(
      {
        ...baseResult,
        recommendations: [
          { ...baseResult.recommendations[0], status: "substituted", finalOperator: "闪灵", note: "关键位替换" },
          { ...baseResult.recommendations[0], original: { operator: "令" }, finalOperator: null, status: "unresolved" },
        ],
      },
      hasAll,
      {},
      { stageKind: "target" },
    );
    return /已替换 1 处/.test(withConflicts) && /无解 <span class="miss">1<\/span> 处/.test(withConflicts);
  })(),
);
check(
  "分区标题：候选池带关数/套数",
  guideHtml.includes("🚩 P1 派遣关攻略") && guideHtml.includes("1 关 2 套") && guideHtml.includes("按黄色格位置识别"),
);
check("分区标题：本关适配阵容", guideHtml.includes("🎯 本关适配阵容"));
check(
  "派遣关结果的总览用「本关阵容」措辞",
  v43.renderResult(baseResult, hasAll, {}, { stageKind: "dispatch" }).includes("🎯 本关阵容"),
);

console.log(failures === 0 ? "\n✅ v4.3 修复清单验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
