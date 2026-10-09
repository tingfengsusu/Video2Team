/**
 * 开发用夹具（不参与扩展运行）：生成一个「假B站视频页 + stub chrome + 真实 dist/content.js」的页面，
 * 用来在浏览器里端到端复现面板相关的问题（勾选不生效、渲染异常、事件链断裂等）。
 *
 *   node scripts/dev-panel-fixture.mjs
 *   node temp/panel-fixture-server.cjs        # 起静态服务（8787）
 *   浏览器打开 http://127.0.0.1:8787/video/BV1TEST?p=2
 *
 * 页面里预置了 storage.local：box（练度表）、advanced、resultCache（一份完整分析结果），
 * 因此面板打开时会走「上次分析」路径渲染候选池——与用户实测场景一致。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

const scheme = (over) => ({
  source: "maa", sourceLabel: "MAA作业", displayCode: "VEC-SP02", stageName: "心中热火",
  operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }], mode: "单人", title: "凯尔希单核",
  details: "", author: "作者A", url: "", bvid: "", views: 0, hotScore: 0, ...over,
});
const bili = (over) => {
  const merged = {
    source: "bili", sourceLabel: "B站视频", displayCode: "VEC-SP02", stageName: "心中热火",
    operators: ["克洛丝"], opers: [{ name: "克洛丝" }], mode: "单人+低星", title: "克洛丝 单人",
    details: "", author: "UP主", url: "https://www.bilibili.com/video/BV1xx", bvid: "BV1xx",
    views: 0, hotScore: 0, ...over,
  };
  if (over.operators) merged.opers = over.operators.map((n) => ({ name: n }));
  return merged;
};
const pool = {
  displayCode: "VEC-SP02", stageId: "act3break_sp02", stageName: "心中热火", counts: { maa: 8, bili: 26 },
  schemes: [
    scheme({ copilotId: 105144 }),
    scheme({ copilotId: 2, operators: ["黑", "机械师"], opers: [{ name: "黑" }, { name: "机械师" }], mode: "双人", title: "黑/机械师双人四号站台" }),
    bili({}),
  ],
};
const result = {
  roster: { stage: "VEC-C", videoId: "BV1TEST", page: 2, source: "screenshot", slots: [{ operator: "凯尔希", isKey: true }, { operator: "克洛丝" }] },
  substitutions: [],
  recommendations: [
    { original: { operator: "凯尔希", isKey: true }, finalOperator: "凯尔希", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "克洛丝" }, finalOperator: "克洛丝", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
  ],
  videoTitle: "【全力以赴】VEC-C 面板夹具",
  stage: "VEC-C（全力以赴）", bvid: "BV1TEST", stageCode: "VEC-C",
  dispatchGuides: [pool],
  dispatchGuideEvidence: { "VEC-SP02": "特别战线网格第 5 格 → VEC-SP02，格内文字「催化装备」" },
  dispatchStageOptions: [
    { displayCode: "VEC-SP01", stageName: "重力危机" },
    { displayCode: "VEC-SP02", stageName: "心中热火" },
    { displayCode: "VEC-SP07", stageName: "荒废矿道" },
    { displayCode: "VEC-SP12", stageName: "四号站台" },
  ],
  stats: { danmakuTotal: 320, commentCandidates: 42, danmakuCandidates: 18 },
};

const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>面板夹具 · 假B站视频页</title></head>
<body style="font-family:system-ui;padding:16px">
<h3>假B站视频页（BV1TEST / p=2）——跑真实 dist/content.js</h3>
<video id="v" width="320" height="180" style="background:#333"></video>
<pre id="boot" style="font-size:12px;color:#666">booting…</pre>
<pre id="errors" style="font-size:12px;color:#c0392b"></pre>
<script>
  const errors = [];
  window.addEventListener("error", (e) => errors.push("error: " + e.message + " @" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));
  const store = {
    box: { operators: { 凯尔希: { name: "凯尔希" }, 黑: { name: "黑" }, 机械师: { name: "机械师" }, 克洛丝: { name: "克洛丝" } }, source: "excel" },
    advanced: { hideUnavailableSchemes: true, schemeRows: 12, colorBySource: true },
    resultCache: { "BV1TEST:2": { ts: Date.now(), result: ${JSON.stringify(result)} } },
  };
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async (msg) => {
        if (msg && msg.type === "GET_TASK") return { task: null };
        if (msg && msg.type === "DISPATCH_QUERY_STAGE") {
          return {
            ok: true,
            pool: {
              displayCode: String(msg.displayCode).toUpperCase(),
              stageId: "act3break_fixture",
              stageName: "夹具关",
              counts: { maa: 2, bili: 1 },
              schemes: [{
                source: "maa", sourceLabel: "MAA作业", displayCode: String(msg.displayCode).toUpperCase(),
                stageName: "夹具关", operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }],
                mode: "单人", title: "夹具方案", details: "", author: "fixture", url: "", bvid: "",
                views: 0, hotScore: 0,
              }],
            },
          };
        }
        return { ok: true };
      },
      getURL: (p) => "/" + p,
      getManifest: () => ({ version: "0.0.0-fixture" }),
      openOptionsPage: () => {},
      lastError: undefined,
    },
    storage: {
      local: {
        get: async (keys) => {
          const ks = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of ks) if (k in store) out[k] = store[k];
          return out;
        },
        set: async (obj) => {
          for (const [k, v] of Object.entries(obj)) store[k] = v;
          for (const fn of listeners) fn(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }])), "local");
        },
        remove: async () => {},
      },
      session: { get: async () => ({}), set: async () => {}, setAccessLevel: async () => {} },
      onChanged: { addListener: (fn) => listeners.push(fn) },
    },
  };
  window.__store = store;
  window.__errors = errors;
  setTimeout(() => {
    document.getElementById("boot").textContent =
      "content.js loaded; host=" + (document.getElementById("video2team-host") ? "已挂载" : "未挂载");
  }, 600);
</script>
<script src="/dist/content.js"></script>
</body></html>`;

const server = `const http = require("http"), fs = require("fs"), path = require("path");
const rootDir = ${JSON.stringify(root)};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split("?")[0]);
  const file = url.startsWith("/video/") ? path.join(rootDir, "temp/panel-fixture.html") : path.join(rootDir, url.replace(/^\\//, ""));
  fs.readFile(file, (e, d) => {
    if (e) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(d);
  });
}).listen(8787, "127.0.0.1", () => console.log("面板夹具服务已启动：http://127.0.0.1:8787/video/BV1TEST?p=2"));
`;

mkdirSync(join(root, "temp"), { recursive: true });
writeFileSync(join(root, "temp/panel-fixture.html"), page);
writeFileSync(join(root, "temp/panel-fixture-server.cjs"), server);
console.log("夹具已生成：temp/panel-fixture.html + temp/panel-fixture-server.cjs");
