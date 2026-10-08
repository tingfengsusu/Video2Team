/**
 * §5 验收自测：反馈文本拼装 + 主按钮行为（不依赖浏览器）。
 *
 *   node scripts/feedback-selftest.mjs
 *
 * 覆盖 design-v4 §5 验收标准：
 *   1. 主按钮 → 剪贴板文本含完整反馈内容，并给出作者私信页 URL（配置 UID 时）
 *   2. 未配置作者 UID → 降级为「仅复制」并提示
 *   3. 未登录B站 → 不出现署名行（且 UI 提示正常，由 options 逻辑保证）
 */

import * as esbuild from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const outfile = join(mkdtempSync(join(tmpdir(), "v2t-feedback-")), "feedback.mjs");

await esbuild.build({
  entryPoints: [join(root, "src/shared/feedback.ts")],
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "node18",
  outfile,
  logLevel: "error",
});

const fb = await import(pathToFileURL(outfile).href);

let failures = 0;
const check = (name, cond, extra = "") => {
  const ok = !!cond;
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

const diagnostics = fb.buildDiagnostics({
  version: "0.2.0",
  mode: "网页版",
  boxCount: 43,
  page: { bvid: "BV1mHpF6qEqF", page: 3 },
  lastError: "B站请求失败 HTTP 412",
});
check("诊断信息含版本/AI模式/box人数", diagnostics.includes("0.2.0") && diagnostics.includes("网页版") && diagnostics.includes("43"));
check("诊断信息含当前页面 BV + 分P", diagnostics.includes("BV1mHpF6qEqF") && diagnostics.includes("分P 3"));
check("诊断信息含最近一次错误", diagnostics.includes("HTTP 412"));

const loggedIn = {
  type: "问题/Bug",
  description: "分析结果把「史尔特尔」识别成了别的干员",
  diagnostics,
  signature: { uname: "苏苏", uid: 12345678 },
};
const text = fb.buildFeedbackText(loggedIn);
check("反馈全文含类型与描述", text.includes("【问题/Bug】") && text.includes("史尔特尔"));
check("已登录 → 含署名行（昵称 + UID）", text.includes("署名：苏苏") && text.includes("12345678"));
check("未登录 → 不出现署名行", !fb.buildFeedbackText({ ...loggedIn, signature: null }).includes("署名"));

const defaultAction = fb.buildFeedbackAction(loggedIn);
check(
  "仓库默认（作者 UID 未配置）→ 主按钮可用且不报错",
  defaultAction.mode === "copy-only" && defaultAction.text === text,
  defaultAction.mode,
);
const degraded = fb.buildFeedbackAction({ ...loggedIn, mid: "" });
check("未配置 UID → 主按钮降级为仅复制", degraded.mode === "copy-only" && degraded.dmUrl === "");
check("未配置 UID → 提示「作者私信直达未配置」", degraded.hint.includes("未配置"));
check("降级模式仍给出完整反馈文本", degraded.text === text);

const configured = fb.buildFeedbackAction({ ...loggedIn, mid: "12345678" });
check("配置 UID → 复制并打开私信", configured.mode === "copy+dm");
check(
  "私信页 URL 正确（whisper/mid{UID}）",
  configured.dmUrl === "https://message.bilibili.com/#/whisper/mid12345678",
  configured.dmUrl,
);

console.log(failures === 0 ? "\n✅ §5 验收自测全部通过" : `\n❌ ${failures} 项未通过`);
process.exit(failures === 0 ? 0 : 1);
