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
      export * from "../src/shared/constants.ts";
      export * from "../src/shared/gridPicker.ts";
      export * from "../src/shared/stageRecode.ts";
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
check("方案前缀标签同步改名", guideHtml.includes(">MAA作业") && guideHtml.includes(">B站视频"));
check("每行只留一个链接（来源标签本身，不再有重复的「视频页↗」）", !guideHtml.includes("视频页↗") && !guideHtml.includes("作业页↗"));

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
/** 只取候选池区块（「特别战线候选池」→「实战替代建议」之间），避免把下方推荐结果算进来 */
const poolSection = (html) => (html.split("🚩 特别战线候选池")[1] ?? "").split("实战替代建议")[0] ?? "";
check("已勾选方案显示 checked", /data-scheme="maa:105144" checked/.test(pickedHtml));
check("结果区被占干员变灰+删除线", pickedHtml.includes('class="occupied"') && pickedHtml.includes("text-decoration:line-through"));
check("被占干员带 🔒 徽章", /occupied[^<]*>[^<]*<\/span><span class="lockbadge"[^>]*>🔒/.test(pickedHtml));
check("候选池内本关自己锁的干员不置灰", !/occupied[^<]*>凯尔希<\/span>/.test(poolSection(pickedHtml)));

console.log("\n== 第十轮 q2/q3：已选关直链已选方案 + 悬浮展开 ==");
const pickedPoolHeader = (pickedHtml.split('data-stage="VEC-SP02"')[1] ?? "").split("</div>")[0] ?? "";
check(
  "已选关的标题链接指向已选方案（不再是作业站首页）",
  pickedPoolHeader.includes('href="https://prts.plus/operation/105144"'),
  pickedPoolHeader.match(/href="[^"]*"/)?.[0] ?? "(无链接)",
);
check(
  "总览里的已选关也带方案直链",
  (pickedHtml.match(/href="https:\/\/prts\.plus\/operation\/105144"/g) ?? []).length >= 2,
  String((pickedHtml.match(/href="https:\/\/prts\.plus\/operation\/105144"/g) ?? []).length),
);
check(
  "未选的关仍退回作业站首页（不误指方案）",
  /<b><a href="https:\/\/prts\.plus\/"[^>]*>VEC-SP02<\/a><\/b>/.test(guideHtml),
);
check(
  "MAA 方案没有作业 id 时退回关卡链接（不谎称直达方案）",
  (() => {
    const noIdPool = { ...guidePool, schemes: [{ ...maaScheme, copilotId: undefined, operators: ["凯尔希"] }] };
    const html = v43.renderResult(
      { ...baseResult, dispatchGuides: [noIdPool] },
      hasAll,
      {},
      { stageKind: "target", picks: { "VEC-SP02": { key: "maa:凯尔希", label: "VEC-SP02", ops: ["凯尔希"] } } },
    );
    return /<b><a href="https:\/\/prts\.plus\/"[^>]*>VEC-SP02<\/a><\/b>/.test(html) && !/打开已选方案/.test(html);
  })(),
);
check(
  "悬浮展开只给已选关（默认收起 → 悬浮即展开）",
  pickedHtml.includes('<details data-hover="1">') && !/<details data-hover="1" open>/.test(pickedHtml),
);
check(
  "未选的关默认展开、不带悬浮（鼠标进出不开合，第十一轮 q2）",
  guideHtml.includes("<details open>") && !/details data-hover/.test(poolSection(guideHtml)),
);

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
  "文字与序号冲突时按序号采用（文字仅作交叉校验，见 stage 自测同项）",
  realConflict.displayCode === "VEC-SP01" && realConflict.needsVerification === true && /已按序号采用/.test(realConflict.note ?? ""),
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
      { position: 1, name: "催化装备" }, // 格内是补给名（不在关卡库）→ 只按序号
      { position: 3, name: "缴械装备" },
    ],
  },
  levels,
);
check(
  "格内是补给名时不影响按序号定位（文字不参与映射）",
  supplyGrid.candidates.map((c) => c.displayCode).join(",") === "VEC-SP01,VEC-SP07",
  supplyGrid.candidates.map((c) => c.displayCode).join(","),
);
// 第十轮 q4：模型写了「当前启用补给 6」却把 gridCells 整组留空 → 必须给可见原因，不能静默丢弃
const noCellButSupplies = v43.resolveDispatchGridFromVision(
  "VEC-C（全力以赴）",
  "【矢量突破】VEC-SP10 后院死局",
  "",
  { explicitCode: "VEC-C", enabledSupplies: 6, gridCells: [], note: "网格内大部分为灰色禁用格，未看到明确黄色底格" },
  levels,
);
check(
  "有启用补给数但读不到格位 → 给出可见原因（不再静默当成非派遣关）",
  noCellButSupplies.candidates.length === 0 &&
    typeof noCellButSupplies.note === "string" &&
    /「当前启用补给」显示 6 个/.test(noCellButSupplies.note) &&
    /格位/.test(noCellButSupplies.note) &&
    /模型说明/.test(noCellButSupplies.note),
  noCellButSupplies.note,
);
// 第十轮补：模型数出了 4×4 与 6 个启用格，只因"格内文字难辨认"整组留空 → 提示要带上尺寸与模型原话
// 第十轮补：提示词必须把「格位」写成必填、格内文字选填（实测模型因"文字难辨认"整组留空）
{
  const promptText = String(
    v43.buildWebCombinedMessages("VEC-C", "阵容文本", [], [], ["data:image/png;base64,x"]).messages[1].content[0]
      .text ?? "",
  );
  check(
    "提示词：格位必填、格名选填（文字读不清也要逐格填 position）",
    /格位是必填项/.test(promptText) && /看不清文字完全不影响填格位/.test(promptText),
  );
  check("提示词：明确不许因文字没读清而整组留空", /更不能因此整组留空/.test(promptText));
  check(
    "提示词：gridRows/gridColumnsTotal 必须填字段并给了 4×4 例子",
    /填进这两个字段/.test(promptText) && /4×4 网格里有 6 个高亮格/.test(promptText),
  );
  check(
    "提示词：格内是图标认不出名称时也要填格位（第十四轮 q1）",
    /格内是图标、认不出名称时照样填格位/.test(promptText) && /不要把位置只写在 note 里/.test(promptText),
  );
}
check(
  "只给出网格尺寸时同样触发提示，并附上模型原话",
  (() => {
    const r = v43.resolveDispatchGridFromVision(
      "VEC-C",
      "【矢量突破】VEC-SP10 后院死局",
      "",
      {
        explicitCode: "",
        gridRows: 4,
        gridColumnsTotal: 4,
        enabledSupplies: 6,
        gridCells: [],
        note: "黄色格子内部文字难以精确辨认，故不填写具体格子信息",
      },
      levels,
    );
    return (
      r.candidates.length === 0 &&
      /（4×4）/.test(r.note ?? "") &&
      /黄色格子内部文字难以精确辨认/.test(r.note ?? "")
    );
  })(),
);
check(
  "没有任何网格线索时仍然静默（不误报）",
  (() => {
    const r = v43.resolveDispatchGridFromVision("VEC-C", "【矢量突破】VEC-C", "", { explicitCode: "VEC-C", gridCells: [] }, levels);
    return r.candidates.length === 0 && !r.note;
  })(),
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
  "序号优先：文字与序号冲突时仍按序号（文字只进提示）",
  namedGrid.candidates.map((c) => c.displayCode).join(",") === "VEC-SP01,VEC-SP07",
  namedGrid.candidates.map((c) => c.displayCode).join(","),
);
check(
  "文字与序号不一致时给出核实提示",
  /已按序号采用，请核实/.test(namedGrid.note ?? ""),
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
      html.includes("B站视频 P12") &&
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
check("标注与 MAA 同阵容的去重条数", note.includes("去重 3 条（与 MAA 同阵容）"));
check("标注被过滤的合集/其它关卡条数", note.includes("过滤 5 条（合集或其它关卡）"));
check("标注被忽略的超期视频条数", note.includes("忽略 7 条（超出 180 天）"), note);
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
  // 7 套方案 + 上限 4 → 触发「另有 N 条方案未展示」；关掉可抄过滤以免 fixture 干员被隐藏
  { stageKind: "target", hideUnavailable: false, maxSchemeRows: 4 },
);
check("渲染含「另有 N 条方案未展示」提示", /另有 \d+ 条方案未展示/.test(poolHtml));
check("MAA 与 B站 方案同屏可见", poolHtml.includes("MAA作业") && poolHtml.includes("bili:BV0"));

console.log("\n== 候选池：可抄过滤 + 显示上限 ==");
/** fixture：operators 变了 opers 也要跟着变（渲染优先用 opers） */
const schemeWith = (over) => {
  const merged = { ...maaScheme, ...over };
  if (over.operators) merged.opers = over.operators.map((n) => ({ name: n }));
  return merged;
};
check(
  "可抄判定：干员都在 box 且未被占用",
  v43.isSchemeUsable(schemeWith({ operators: ["凯尔希"] }), () => true, {}, "VEC-SP02").usable === true,
);
check(
  "可抄判定：缺干员 → 不可抄并给出原因",
  (() => {
    const v = v43.isSchemeUsable(schemeWith({ operators: ["凯尔希", "银灰"] }), (n) => n === "凯尔希", {}, "VEC-SP02");
    return !v.usable && /缺 银灰/.test(v.reason ?? "");
  })(),
);
check(
  "可抄判定：被别的关占用 → 不可抄；本关自己占用不算",
  (() => {
    const locksOther = { 凯尔希: "VEC-SP05（难以相交）" };
    const locksSelf = { 凯尔希: "VEC-SP02（心中热火）" };
    const ops = ["凯尔希"];
    return (
      !v43.isSchemeUsable(schemeWith({ operators: ops }), () => true, locksOther, "VEC-SP02").usable &&
      v43.isSchemeUsable(schemeWith({ operators: ops }), () => true, locksSelf, "VEC-SP02").usable
    );
  })(),
);

const poolWithMix = {
  ...guidePool,
  schemes: [
    schemeWith({ operators: ["凯尔希"] }), // 有
    schemeWith({ copilotId: 2, operators: ["银灰"] }), // 缺
    schemeWith({ copilotId: 3, operators: ["能天使"], source: "bili", sourceLabel: "B站视频", bvid: "BV1X", url: "" }), // 被占
  ],
};
const mixedHtml = v43.renderResult(
  { ...baseResult, dispatchGuides: [poolWithMix] },
  (n) => n !== "银灰",
  { 能天使: "VEC-SP05（难以相交）" },
  { stageKind: "target", hideUnavailable: true },
);
// 第十三轮 q1：缺干员的方案默认折叠在 [data-hidden-schemes] 里（可「点开查看」），不在可见行里
check(
  "缺干员的方案不在可见行里，但留在「点开查看」的折叠块里",
  !/data-ops="银灰"/.test(mixedHtml.split('data-hidden-schemes')[0]) &&
    /data-hidden-schemes[^>]*hidden/.test(mixedHtml) &&
    /data-ops="银灰"/.test(mixedHtml),
);
check(
  "「已隐藏 N 条缺干员的方案」旁边给了「点开查看」入口",
  /已隐藏 1 条缺干员的方案/.test(mixedHtml) && mixedHtml.includes('data-act="show-hidden"'),
);
check(
  "只隐藏缺干员的（说明里是「缺干员的方案」，不是「不可抄」）",
  /已隐藏 1 条缺干员的方案/.test(mixedHtml) && !/已隐藏 2 条/.test(mixedHtml),
  mixedHtml.match(/已隐藏[^<]*/)?.[0],
);
check(
  "被别的关占用的方案仍显示，但干员置灰（便于跨关对比与改占用）",
  /data-ops="能天使"/.test(mixedHtml) && /occupied[^<]*>能天使/.test(mixedHtml),
);
check(
  "并标注被哪一关占用、说明勾选会把占用改过来",
  /已被\s*<b>VEC-SP05/.test(mixedHtml) && /勾选本方案会把占用改到本关/.test(mixedHtml),
  mixedHtml.match(/⚠[^<]*/)?.[0],
);
const showAllHtml = v43.renderResult(
  { ...baseResult, dispatchGuides: [poolWithMix] },
  (n) => n !== "银灰",
  { 能天使: "VEC-SP05（难以相交）" },
  { stageKind: "target", hideUnavailable: false },
);
check("关掉过滤后缺干员的也显示", showAllHtml.includes("银灰") && showAllHtml.includes("能天使") && !/已隐藏/.test(showAllHtml));
const allUnusableHtml = v43.renderResult(
  { ...baseResult, dispatchGuides: [{ ...guidePool, schemes: [schemeWith({ operators: ["没练的人"] })] }] },
  () => false,
  {},
  { stageKind: "target", hideUnavailable: true },
);
check("整关都缺干员时说明原因（不留空白）", /该关 1 套方案缺干员/.test(allUnusableHtml), allUnusableHtml.match(/该关[^<]*/)?.[0]);

console.log("\n== 派遣关纠错入口：只留「＋ 补一个关…」 ==");
const addStageHtml = v43.renderResult(
  { ...baseResult, dispatchGuides: [guidePool] },
  hasAll,
  {},
  {
    stageKind: "target",
    stageOptions: [
      { displayCode: "VEC-SP02", stageName: "心中热火" }, // 已在候选池 → 不列
      { displayCode: "VEC-SP05", stageName: "难以相交" }, // 漏识别 → 应列
    ],
  },
);
check(
  "补关下拉用 .stage-select 类（各界面 CSS 统一按卡片风格上色）",
  addStageHtml.includes('class="stage-select"') && addStageHtml.includes('data-act="add-stage"'),
);
check("下拉只列当前候选池里还没出现的关", addStageHtml.includes('<option value="VEC-SP05">VEC-SP05（难以相交）</option>') && !addStageHtml.includes('<option value="VEC-SP02">'));
check("入口文案是「＋ 补一个关…」，不再有「改成…」", addStageHtml.includes("＋ 补一个关…") && !addStageHtml.includes("改成"));
const noOptionsHtml = v43.renderResult({ ...baseResult, dispatchGuides: [guidePool] }, hasAll, {}, { stageKind: "target" });
check("没有可补的关时整行不出现", !noOptionsHtml.includes("补一个关") && !noOptionsHtml.includes("stage-select"));

const manyRows = v43.pickVisibleSchemes(
  Array.from({ length: 30 }, (_, i) => ({ source: i % 2 ? "maa" : "bili", tag: `S${i}` })),
  { total: 12, perSource: 6 },
);
check("显示上限放宽到 12 条（不再是 3+3）", manyRows.shown.length === 12, String(manyRows.shown.length));

console.log("\n== 页面元素一致性（防止「删了面板但监听还在」打断初始化） ==");
{
  // 只检查 `$("id")` / `$<T>("id")` 这类元素取用：这类引用一旦指向不存在的元素，
  // 就是"init 抛错 → 后续监听全没挂上"的元凶（2026-10-09 大窗口实测）。
  const fsx = await import("node:fs");
  const pathx = await import("node:path");
  const here = pathx.dirname(new URL(import.meta.url).pathname.replace(/^[\\/]([A-Za-z]:)/, "$1"));
  const rootDir = pathx.join(here, "..");
  const optional = new Set(["locks", "lockCount", "poolFilterNote", "kpis", "reanalyze", "clearPageCache"]); // 有守卫/运行时创建，可缺
  const idRe = /\bid="([A-Za-z][\w-]*)"/g;
  const useRe = /\$<[^>]*>\("([A-Za-z][\w-]*)"\)|\$\("([A-Za-z][\w-]*)"\)/g;
  for (const [htmlPath, tsPath] of [
    ["src/result/index.html", "src/result/main.ts"],
    ["src/popup/index.html", "src/popup/main.ts"],
  ]) {
    const html = fsx.readFileSync(pathx.join(rootDir, htmlPath), "utf8");
    const ts = fsx.readFileSync(pathx.join(rootDir, tsPath), "utf8");
    const ids = new Set([...html.matchAll(idRe)].map((mm) => mm[1]));
    const used = new Set([...ts.matchAll(useRe)].map((mm) => mm[1] ?? mm[2]));
    const missing = [...used].filter((id) => !ids.has(id) && !optional.has(id));
    check(
      tsPath.split("/").pop() + " 取用的元素都存在（" + used.size + " 个）",
      missing.length === 0,
      missing.join("、"),
    );
  }
}

console.log("\n== 单字干员名（黑/令/黍…）与勾选兜底 ==");
check(
  "单字干员名可识别（黑/机械师 双人）",
  v43.matchOperators("黑/机械师双人四号站台 VEC-SP12", db).join("、") === "黑、机械师",
);
check(
  "单字干员名：紧贴模式词也识别（黍单核）",
  v43.matchOperators("黍单核 挂机 VEC-SP02", db).join("、") === "黍",
);
check(
  "单字干员名：不误伤真词（黑角 / 指令）",
  (() => {
    const a = v43.matchOperators("黑角 单人 VEC-SP01", db).join("、");
    const b = v43.matchOperators("凯尔希可以替askl（指令区）", db).join("、");
    return a === "黑角" && b === "凯尔希";
  })(),
);
console.log("\n== 第十轮 q1：长名里的短名不再重复命中 ==");
check(
  "「麒麟R夜刀单人…」只出 1 个干员（不再拆出「夜刀」）",
  v43.matchOperators("矢量突破】麒麟R夜刀单人VEC-SP10后院死局", db).join("、") === "麒麟R夜刀",
  v43.matchOperators("矢量突破】麒麟R夜刀单人VEC-SP10后院死局", db).join("、"),
);
check(
  "「焰狐龙梓兰单人…」只出 1 个干员（不再拆出「梓兰」）",
  v43.matchOperators("矢量突破[特别战线] vec-sp10 焰狐龙梓兰单人", db).join("、") === "焰狐龙梓兰",
  v43.matchOperators("矢量突破[特别战线] vec-sp10 焰狐龙梓兰单人", db).join("、"),
);
check(
  "真的分开写两个名字时仍然都识别（麒麟R夜刀、夜刀）",
  v43.matchOperators("麒麟R夜刀、夜刀 双人 VEC-SP10", db).join("、") === "麒麟R夜刀、夜刀",
  v43.matchOperators("麒麟R夜刀、夜刀 双人 VEC-SP10", db).join("、"),
);

console.log("\n== 第十二轮 p1/p3：序号归位 + 关卡名与干员名撞车护栏 ==");
{
  const pool02 = { ...guidePool };
  const pool10 = { ...guidePool, displayCode: "VEC-SP10", stageId: "act3break_sp10", stageName: "后院死局" };
  const withOrder = {
    ...baseResult,
    dispatchGuides: [pool10],
    dispatchStageOptions: [
      { displayCode: "VEC-SP02", stageName: "心中热火" },
      { displayCode: "VEC-SP05", stageName: "难以相交" },
      { displayCode: "VEC-SP07", stageName: "荒废矿道" },
      { displayCode: "VEC-SP10", stageName: "后院死局" },
    ],
  };
  const merged = v43.patchStagePools(withOrder, [pool02]);
  check(
    "手动补的关按本活动序号归位（SP02 排到 SP10 前面，不是追加在末尾）",
    merged.dispatchGuides.map((p) => p.displayCode).join(",") === "VEC-SP02,VEC-SP10",
    merged.dispatchGuides.map((p) => p.displayCode).join(","),
  );
}
{
  // 实测坑：关卡「0-9」的通名是「临光」，而「临光」也是干员名、还是「耀骑士临光」的子串
  const lv = [
    { displayCode: "0-9", name: "临光", stageId: "main_09", eventName: "主线" },
    { displayCode: "VEC-SP07", name: "投资回报", stageId: "act3break_sp07", eventName: "矢量突破#3" },
  ];
  const guard = { isOperatorLike: (n) => n === "临光" || "耀骑士临光".includes(n) };
  const fromDesc = v43.resolveStageFromText(
    "【月行水上】SR-EX-1至8突袭",
    "SR-EX-1至8 摆完挂机",
    "阵容里用耀骑士临光替代了原来的干员，临光开技能即可",
    lv,
    guard,
  );
  check(
    "简介里提到干员（临光/耀骑士临光）不再把关卡带跑成「0-9（临光）」",
    fromDesc.displayCode !== "0-9",
    `${fromDesc.source}/${fromDesc.displayCode ?? "(无)"}`,
  );
  const fromTitle = v43.resolveStageFromText("0-9 临光 挂机", "", "", lv, guard);
  check(
    "但标题里真写了这个关名时仍然算数（0-9 临光）",
    fromTitle.displayCode === "0-9",
    `${fromTitle.source}/${fromTitle.displayCode ?? "(无)"}`,
  );
}

console.log("\n== 第十四轮 q1：模型把格位写在 note 里 → 解析成序号 ==");
check(
  "解析「4行4列 + 第2行第1、2、3格 + 第3行第2、3、4格」→ 格位 5/6/7/10/11/12",
  JSON.stringify(
    v43
      .parseGridCellsFromNote(
        "画面显示当前启用补给 6/6，网格为4行4列，高亮格为第2行第1、2、3格，第3行第2、3、4格，共6格，但格内文字为图标形式难以准确识别名称，故仅记录数量与位置信息",
        4,
      )
      .map((c) => c.position),
  ) === "[5,6,7,10,11,12]",
);
check(
  "「共6格」这类计数不会被当成列号",
  !v43.parseGridCellsFromNote("4行4列，高亮格为第3行第2、3、4格，共6格", 4).some((c) => c.column === 6),
);
check(
  "直接给序号列表也能解析（第5、6、7格）",
  JSON.stringify(v43.parseGridCellsFromNote("高亮格为第5、6、7格", 4).map((c) => c.position)) === "[5,6,7]",
);
{
  // 16 个补给关的完整关卡库：位置 5/6/7/10/11/12 → VEC-SP05/06/07/10/11/12
  const bigLevels = Array.from({ length: 16 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return {
      displayCode: "VEC-SP" + n,
      stageId: "act3break_sp" + n,
      name: "测试关" + (i + 1),
      eventName: "矢量突破#3 拟生态",
    };
  });
  const noteOnly = v43.resolveDispatchGridFromVision(
    "VEC-C（全力以赴）",
    "【矢量突破#3】特别战线 补给网格",
    "",
    {
      enabledSupplies: 6,
      gridCells: [],
      note: "画面显示当前启用补给 6/6，网格为4行4列，高亮格为第2行第1、2、3格，第3行第2、3、4格，共6格，但格内文字为图标形式难以准确识别名称",
    },
    bigLevels,
  );
  check(
    "模型只把格位写在 note 里 → 依然识别出 6 个派遣关，并说明格位来源",
    noteOnly.candidates.map((c) => c.displayCode).join(",") ===
      "VEC-SP05,VEC-SP06,VEC-SP07,VEC-SP10,VEC-SP11,VEC-SP12" &&
      /格位来自模型说明/.test(noteOnly.note ?? ""),
    noteOnly.candidates.map((c) => c.displayCode).join(",") + "｜" + (noteOnly.note ?? ""),
  );
}

console.log("\n== 第十一轮 q3/q4：选择补给关 + 关卡链 ==");
check(
  "关卡链配置：SP10→SP09、SP12→SP11，且不重复加已在列表里的",
  v43.chainPrereqs(["VEC-SP10"]).join(",") === "VEC-SP09" &&
    v43.chainPrereqs(["VEC-SP12"]).join(",") === "VEC-SP11" &&
    v43.chainPrereqs(["VEC-SP09", "VEC-SP10"]).length === 0 &&
    v43.chainPrereqs(["VEC-SP05"]).length === 0,
);
{
  const sp10 = { ...guidePool, displayCode: "VEC-SP10", stageId: "act3break_sp10", stageName: "后院死局" };
  const sp09 = { ...guidePool, displayCode: "VEC-SP09", stageId: "act3break_sp09", stageName: "调度中心" };
  const chainHtml = v43.renderResult(
    { ...baseResult, dispatchGuides: [sp09, sp10], dispatchStageChain: { "VEC-SP10": "VEC-SP09" } },
    hasAll,
    {},
    { stageKind: "target" },
  );
  check(
    "结果页写出「关卡链：本关需要先打 …（已自动加入候选池）」",
    /关卡链：本关需要先打 <b>VEC-SP09<\/b>/.test(chainHtml),
    chainHtml.match(/关卡链：[^<]*<b>[^<]*/)?.[0],
  );
  check(
    "前置关一侧写出「谁需要先打本关」",
    /关卡链：<b>VEC-SP10<\/b> 需要先打本关/.test(chainHtml),
    chainHtml.match(/关卡链：<b>[^<]*/)?.[0],
  );
}
{
  const gridHtml = v43.renderResult(baseResult, hasAll, {}, {
    stageKind: "target",
    stageOptions: [
      { displayCode: "VEC-SP02", stageName: "心中热火" }, // 已在候选池 → 禁用
      { displayCode: "VEC-SP05", stageName: "难以相交" },
      { displayCode: "VEC-SP09", stageName: "调度中心" },
    ],
  });
  check(
    "「选择补给关…」按钮在候选池**顶部**（第一个关卡块之前，第十一轮 p3）",
    gridHtml.includes('data-act="open-grid"') &&
      gridHtml.includes("选择补给关…") &&
      gridHtml.indexOf('data-act="open-grid"') < gridHtml.indexOf('class="stagepool"'),
  );
  check(
    "浮层按序号渲染格子（含 1/3 号）",
    gridHtml.includes('class="gridpicker"') && gridHtml.includes("<b>1</b>") && gridHtml.includes("<b>3</b>"),
  );
  check(
    "已在候选池的格子默认勾着、但标成 in-pool（应用时跳过查询，第十二轮 p1）",
    /class="gp-cell in-pool on"[^>]*data-in-pool="1"/.test(gridHtml) &&
      !/class="gp-cell in-pool[^"]*"[^>]*disabled/.test(gridHtml),
  );
  check(
    "已选计数从「池里的关」起算，且没有新选的关时应用按钮禁用",
    /data-act="apply-grid" disabled/.test(gridHtml) && gridHtml.includes('已选 <b>1</b> 关'),
  );
  const noOptionsHtml = v43.renderResult(baseResult, hasAll, {}, { stageKind: "target" });
  check("拿不到派遣关清单时不渲染浮层/按钮", !noOptionsHtml.includes("gridpicker") && !noOptionsHtml.includes("open-grid"));
}

/** 最小 input 桩：resolvePickFromRow 只用 getAttribute / closest */
const fakeInput = (attrs, rowAttrs) => ({
  getAttribute: (k) => attrs[k] ?? null,
  closest: () => ({ getAttribute: (k) => rowAttrs[k] ?? null }),
});
const pickResult = { dispatchGuides: [guidePool] };
check(
  "勾选解析：正常命中结果里的方案",
  (() => {
    const info = v43.resolvePickFromRow(
      fakeInput({ "data-stage": "VEC-SP02", "data-scheme": "maa:105144" }, {}),
      pickResult,
    );
    return info?.fromResult === true && info.ops.join("+") === "凯尔希+能天使";
  })(),
);
check(
  "勾选解析：结果里查不到时用行内 data-ops 兜底（不再静默失败）",
  (() => {
    const info = v43.resolvePickFromRow(
      fakeInput({ "data-stage": "VEC-SP02", "data-scheme": "maa:不存在的作业" }, { "data-ops": "黑、机械师" }),
      pickResult,
    );
    return info?.fromResult === false && info.ops.join("+") === "黑+机械师" && info.stageCode === "VEC-SP02";
  })(),
);
check(
  "勾选解析：行内数据也没有时返回 null（上层给可见提示）",
  v43.resolvePickFromRow(fakeInput({ "data-stage": "VEC-SP02", "data-scheme": "x" }, {}), pickResult) === null,
);

console.log("\n== 前置关识别依据 + 「不是这关」排除 ==");
const withEvidence = v43.renderResult(baseResult, hasAll, {}, {
  stageKind: "target",
  guideEvidence: { "VEC-SP02": "P1 网格第 5 格，格内读到「催化装备」" },
});
check(
  "显示每关的识别依据（网格第几格 / 格内读到什么）",
  withEvidence.includes("识别依据：P1 网格第 5 格，格内读到「催化装备」"),
);
check(
  "提供「不是这关」入口",
  withEvidence.includes('data-act="skip-stage"') && withEvidence.includes('data-code="VEC-SP02"'),
);
const excludedHtml = v43.renderResult(baseResult, hasAll, {}, {
  stageKind: "target",
  excludedStages: ["VEC-SP02"],
});
check("被排除的关不再出现在候选池", !excludedHtml.includes('data-pick-row="1"'));
check(
  "并给出「恢复」入口",
  excludedHtml.includes('data-act="restore-stage"') && excludedHtml.includes("已排除（识别不准）"),
);

console.log("\n== 候选池交互（第五轮）：整行可点选 / 悬浮详情 / 来源配色 / 折叠 ==");
const rowHtml = v43.renderResult(baseResult, hasAll, {}, { stageKind: "target", hideUnavailable: false });
check("方案行可整行点选", rowHtml.includes('data-pick-row="1"'));
check(
  "方案行带 data-ops（勾选兜底依赖它）",
  rowHtml.includes('data-ops="凯尔希" ') || /data-ops="[^"]+"/.test(rowHtml),
);
check(
  "标题/作者/合集移入悬浮提示（行内不再刷屏）",
  /title="MAA作业[^"]*标题：凯尔希单核/.test(rowHtml) && !rowHtml.includes("｜ 凯尔希单核"),
);
check(
  "来源配色：MAA 蓝 / B站 粉",
  rowHtml.includes("color:#0969da;font-weight:700") && rowHtml.includes("color:#e0559b;font-weight:700"),
);
const monoHtml = v43.renderResult(baseResult, hasAll, {}, { stageKind: "target", colorBySource: false });
check("关闭配色开关后统一蓝色", !monoHtml.includes("#e0559b") && monoHtml.includes("#0969da"));
check(
  "未选关默认展开、已选关默认收起（<details>）",
  rowHtml.includes("<details open>") &&
    !/details data-hover/.test(rowHtml) &&
    pickedHtml.includes('<details data-hover="1">') &&
    !/<details data-hover="1" open>/.test(pickedHtml),
);
check("折叠摘要标出候选方案数", /候选方案 \d+ 套/.test(rowHtml));

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
  "分区标题：候选池带关数/套数（不再自称 P1）",
  guideHtml.includes("🚩 特别战线候选池") && guideHtml.includes("1 关 2 套") && guideHtml.includes("按黄色格位置识别") && !guideHtml.includes("P1 派遣关攻略"),
);
check("分区标题：本关适配阵容", guideHtml.includes("🎯 本关适配阵容"));
check(
  "派遣关结果的总览用「本关阵容」措辞",
  v43.renderResult(baseResult, hasAll, {}, { stageKind: "dispatch" }).includes("🎯 本关阵容"),
);

console.log(failures === 0 ? "\n✅ v4.3 修复清单验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
