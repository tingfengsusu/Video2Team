/**
 * §2 验收自测：把 src/shared/maa.ts 打成 ESM 后在 Node 里直接跑真接口。
 *
 *   node scripts/maa-selftest.mjs
 *
 * 覆盖 design-v4 §2 验收标准：
 *   1. 输入 VEC-SP07 → 返回该关候选方案列表，方案含标准干员名
 *   2. 一次 `act3break_sp` 前缀查询产出全部派遣关的候选池
 *   3. 显示码 ↔ 内部码按关卡库解析（VEC-SP07 ≠ act3break_sp07）
 */

import * as esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outfile = join(mkdtempSync(join(tmpdir(), "v2t-maa-")), "maa.mjs");

await esbuild.build({
  entryPoints: [join(root, "src/shared/maa.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node18",
  outfile,
  logLevel: "error",
});

const maa = await import(pathToFileURL(outfile).href);

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const levels = await maa.getLevelDb();
check("关卡库拉取成功", levels.length > 3000, `${levels.length} 条`);
check("关卡库缓存命中（第二次不再请求）", (await maa.getLevelDb()).length === levels.length);

const prefix = await maa.resolveEventPrefix("VEC-01");
check("VEC-01 → 当前活动前缀 act3break", prefix === "act3break", prefix);

const stages = await maa.listDispatchStages("act3break");
check("act3break 派遣关清单 = 16 关", stages.length === 16, `${stages.length} 关`);

const one = await maa.queryCopilots("act3break_sp11");
check("act3break_sp11 有作业", !one.failed && one.schemes.length > 0, `${one.schemes.length} 条 / total ${one.total}`);
check(
  "内部码 act3break_sp11 反查显示码 = VEC-SP07",
  one.schemes.length > 0 && one.schemes.every((s) => s.displayCode === "VEC-SP07"),
  one.schemes[0]?.displayCode,
);
check(
  "方案含游戏标准全名干员",
  one.schemes.some((s) => s.opers.length > 0 && s.opers.every((o) => !!o.name)),
  one.schemes[0]?.opers.map((o) => o.name).join("/"),
);
check(
  "方案带来源（uploader / copilotId）",
  one.schemes.every((s) => s.copilotId > 0 && !!s.uploader),
);

const pools = await maa.buildDispatchPool("act3break", { maxPages: 4, perStageLimit: 8 });
check("一次前缀查询产出全部 16 关的候选池", pools.length === 16, `${pools.length} 个池`);
const withSchemes = pools.filter((p) => p.schemes.length > 0);
check("多数关有候选方案", withSchemes.length >= 10, `${withSchemes.length}/16 关有方案`);
check(
  "候选池展示码唯一",
  new Set(pools.map((p) => p.displayCode)).size === pools.length,
);

const junk = await maa.queryCopilots("__no_such_level__");
check("无效内部码不泄漏无关作业（后端会忽略未匹配 keyword）", junk.schemes.length === 0, `${junk.schemes.length} 条`);

// 模拟断网：接口异常 → failed:true / 空结果，且关卡库回落到已缓存的快照
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("simulated offline");
};
const offlineQuery = await maa.queryCopilots("act3break_sp11");
check("断网时 queryCopilots 静默降级（failed=true 且不抛异常）", offlineQuery.failed === true && offlineQuery.schemes.length === 0);
const offlineLevels = await maa.getLevelDb({ force: true });
check("断网时关卡库回落缓存快照", offlineLevels.length === levels.length, `${offlineLevels.length} 条`);
globalThis.fetch = realFetch;

console.log(failures === 0 ? "\n✅ §2 验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
