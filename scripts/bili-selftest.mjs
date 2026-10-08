/**
 * §3 验收自测：把 src/shared/biliDig.ts 与 src/shared/dispatchPool.ts 打成 ESM 后在 Node 里跑。
 *
 *   node scripts/bili-selftest.mjs
 *
 * 覆盖 design-v4 §3 验收标准：
 *   1. 搜索 VEC-SP07 → 候选池含「凯尔希单人 / 泥岩单人 / 阿米娅+蛇屠箱」等方案
 *   2. 三级语料合并后只调一次 LLM，输出经干员字典 + 纠错集校验
 *   3. 标题空心（无干员）不产生幻觉条目；合并池跨源去重不错乱
 *   4. 搜索失败（断网/风控）静默降级（failed=true，不抛异常）
 */

import * as esbuild from "esbuild";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "v2t-bili-"));

async function bundle(entry, name) {
  const outfile = join(dir, name);
  await esbuild.build({
    entryPoints: [join(root, entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "node18",
    outfile,
    logLevel: "error",
  });
  return import(pathToFileURL(outfile).href);
}

const dig = await bundle("src/shared/biliDig.ts", "biliDig.mjs");
const pool = await bundle("src/shared/dispatchPool.ts", "dispatchPool.mjs");

// ---- 构造与生产一致的 NameDict（真实干员表 + 打包纠错集） ----
const table = JSON.parse(readFileSync(join(root, "data/operators.json"), "utf8"));
const aliasFile = JSON.parse(readFileSync(join(root, "data/aliases.json"), "utf8"));
const aliases = aliasFile.aliases ?? {};
const names = new Set();
for (const info of Object.values(table)) if (info?.name) names.add(info.name);
const dict = {
  names: () => [...names],
  resolve: (name) => aliases[String(name).trim()] ?? String(name).trim(),
  exists: (name) => names.has(aliases[String(name).trim()] ?? String(name).trim()),
};

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

// ---------- 离线：字典匹配 / 纠错集 / 顺序 ----------
check("干员字典装载", names.size > 400, `${names.size} 人`);
check(
  "标题干员提取：只认确凿出现的全名",
  JSON.stringify(dig.matchOperators("VEC-SP07 凯尔希单人 低配", dict)) === JSON.stringify(["凯尔希"]),
  dig.matchOperators("VEC-SP07 凯尔希单人 低配", dict).join("/"),
);
check(
  "纠错集：42 → 史尔特尔",
  dig.matchOperators("42单核过图", dict).includes("史尔特尔"),
  dig.matchOperators("42单核过图", dict).join("/"),
);
check(
  "多干员命中顺序稳定：阿米娅+蛇屠箱",
  JSON.stringify(dig.matchOperators("阿米娅+蛇屠箱 双人", dict)) ===
    JSON.stringify(["阿米娅", "蛇屠箱"]),
  dig.matchOperators("阿米娅+蛇屠箱 双人", dict).join("/"),
);
check(
  "模式标签识别（单人+低星+挂机）",
  dig.detectMode("凯尔希单人低星挂机") === "单人+低星+挂机",
  dig.detectMode("凯尔希单人低星挂机"),
);

// ---------- 离线：LLM 回复过滤幻觉 + 空心标题丢弃 ----------
const entries = [
  { bvid: "BV1", text: "VEC-SP07 凯尔希单人", kind: "title", title: "VEC-SP07 凯尔希单人" },
  { bvid: "BV2", text: "VEC-SP07 超高难打法思路分享", kind: "title", title: "VEC-SP07 超高难打法思路分享" },
  { bvid: "BV3", text: "VEC-SP07 阿米娅+蛇屠箱 双人", kind: "title", title: "VEC-SP07 阿米娅+蛇屠箱 双人" },
];
const llmReply = JSON.stringify({
  schemes: [
    { index: 0, operators: ["凯尔希"], mode: "单人" },
    { index: 1, operators: ["不存在干员X"], mode: "单人" }, // 幻觉名 → 过滤后为空 → 丢弃
    { index: 2, operators: ["阿米娅", "蛇屠箱"], mode: "双人" },
  ],
});
const parsed = dig.parseExtractReply(llmReply, entries, dict);
check("LLM 幻觉干员名被字典过滤", parsed.length === 2 && !parsed.some((s) => s.operators.includes("不存在干员X")));
check(
  "空心标题（无干员）不产生条目",
  !parsed.some((s) => s.bvid === "BV2"),
  parsed.map((s) => s.bvid).join("/"),
);

const byDict = dig.extractByDictionary(entries, dict);
check(
  "字典兜底同样丢弃空心标题",
  byDict.length === 2 && byDict.every((s) => s.operators.length > 0),
  byDict.map((s) => `${s.bvid}:${s.operators.join("+")}`).join(" / "),
);

// ---------- 离线：候选池合并去重（MAA 优先） ----------
const biliSchemes = [
  { bvid: "BVk", url: "https://www.bilibili.com/video/BVk", title: "VEC-SP07 凯尔希单人", operators: ["凯尔希"], mode: "单人", author: "UP-甲", kind: "title" },
  { bvid: "BVn", url: "https://www.bilibili.com/video/BVn", title: "VEC-SP07 泥岩单人", operators: ["泥岩"], mode: "单人", author: "UP-乙", kind: "part" },
];
const maaPool = {
  displayCode: "VEC-SP07",
  stageId: "act3break_sp11",
  stageName: "投资回报",
  schemes: [
    {
      copilotId: 9527,
      stageId: "act3break_sp11",
      displayCode: "VEC-SP07",
      stageName: "投资回报",
      title: "凯尔希单人",
      details: "可借助战",
      opers: [{ name: "凯尔希", skill: 3 }],
      groups: [],
      uploader: "MAA-U",
      uploaderId: "1",
      views: 100,
      hotScore: 10,
    },
  ],
};
const merged = pool.mergeStagePool(maaPool, biliSchemes);
check(
  "跨源合并去重（凯尔希只保留 MAA作业一条）",
  merged.schemes.length === 2 && merged.schemes.filter((s) => s.operators.join("+") === "凯尔希").length === 1,
  merged.schemes.map((s) => `${s.source}:${s.operators.join("+")}`).join(" / "),
);
check(
  "MAA 方案标记「MAA作业」且带技能",
  merged.schemes[0].source === "maa" &&
    merged.schemes[0].sourceLabel === "MAA作业" &&
    merged.schemes[0].opers[0].skill === 3,
);
check(
  "B站补充方案标记「B站视频」且带 bvid",
  merged.schemes[1].source === "bili" &&
    merged.schemes[1].sourceLabel === "B站视频" &&
    !!merged.schemes[1].bvid,
);

// ---------- 在线：真实搜索 VEC-SP07（字典兜底路径） ----------
const res = await dig.mineStage("VEC-SP07", dict, { ask: null, pages: 2 });
check("真实搜索成功（非 failed）", res.failed === false, `searched ${res.stats.searched} 条`);
check("候选池非空", res.schemes.length > 0, `${res.schemes.length} 条`);
check("所有条目都有干员（无空心幻觉）", res.schemes.every((s) => s.operators.length > 0));
check(
  "所有干员都过字典校验",
  res.schemes.every((s) => s.operators.every((n) => dict.exists(n))),
);
const combos = res.schemes.map((s) => s.operators.join("+"));
check("候选池覆盖「凯尔希单人」", combos.some((c) => c === "凯尔希"), combos.slice(0, 8).join(" / "));
check(
  "候选池覆盖「泥岩」与「阿米娅+蛇屠箱」中的至少一项",
  combos.some((c) => c === "泥岩" || c === "阿米娅+蛇屠箱"),
);
check(
  "同 bvid + 干员组合无重复",
  new Set(res.schemes.map((s) => `${s.bvid}|${s.operators.join("+")}`)).size === res.schemes.length,
);

// ---------- 在线：三级语料 → 只调一次 LLM ----------
let calls = 0;
const ask = async (messages) => {
  calls += 1;
  const text = typeof messages[messages.length - 1].content === "string" ? messages[messages.length - 1].content : "";
  const firstIndex = Number(/(?:^|\n)(\d+) \| /m.exec(text)?.[1] ?? 0);
  return JSON.stringify({ schemes: [{ index: firstIndex, operators: ["凯尔希"], mode: "单人" }] });
};
const llmRes = await dig.mineStage("VEC-SP07", dict, {
  ask,
  pages: 1,
  maxPartsVideos: 0,
  maxDescVideos: 0,
});
check("三级语料合并后只调用一次 LLM", calls === 1, `${calls} 次`);
check("LLM 路径产出经字典校验的方案", llmRes.stats.llmUsed === true && llmRes.schemes.every((s) => dict.exists(s.operators[0])), llmRes.schemes[0]?.operators.join("+"));

// ---------- 断网静默降级 ----------
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("simulated offline");
};
const offline = await dig.mineStage("VEC-SP07", dict, { ask: null, pages: 1 });
check("断网时静默降级（failed=true 且不抛异常）", offline.failed === true && offline.schemes.length === 0);
globalThis.fetch = realFetch;

console.log(failures === 0 ? "\n✅ §3 验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
