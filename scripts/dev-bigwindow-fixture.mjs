/**
 * 开发用夹具（不参与扩展运行）：把 dist/result.html（大窗口结果页）套上 chrome stub 跑起来，
 * 用于复现「大窗口里勾选/渲染不生效」这类问题。
 *
 *   node scripts/dev-bigwindow-fixture.mjs     # 生成 dist/__fixture-bigwindow.html
 *   node temp/panel-fixture-server.cjs          # 静态服务（8787）
 *   浏览器打开 http://127.0.0.1:8787/dist/__fixture-bigwindow.html
 *
 * 说明：夹具必须放在 dist/ 下，页面里的 `./result.js` 才能解析到真实脚本。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const distHtml = join(root, "dist/result.html");
if (!existsSync(distHtml)) throw new Error("请先 npm run build（缺少 dist/result.html）");

// ---- 与面板夹具一致的示例结果 ----
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
    scheme({}),
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
  videoTitle: "【全力以赴】VEC-C 大窗口夹具",
  stage: "VEC-C（全力以赴）", bvid: "BV1TEST", stageCode: "VEC-C",
  dispatchGuides: [pool],
  dispatchGuideEvidence: { "VEC-SP02": "特别战线网格第 5 格 → VEC-SP02，格内文字「催化装备」" },
  dispatchStageOptions: [
    { displayCode: "VEC-SP01", stageName: "重力危机" },
    { displayCode: "VEC-SP02", stageName: "心中热火" },
    { displayCode: "VEC-SP12", stageName: "四号站台" },
  ],
  stats: { danmakuTotal: 320, commentCandidates: 42, danmakuCandidates: 18 },
};

const stub = `
<script>
  window.__errors = [];
  window.addEventListener("error", (e) => window.__errors.push("error: " + e.message + " @" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => window.__errors.push("rejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));
  const localStore = {
    box: { operators: { 凯尔希: { name: "凯尔希" }, 黑: { name: "黑" }, 机械师: { name: "机械师" }, 克洛丝: { name: "克洛丝" } }, source: "excel" },
    advanced: { hideUnavailableSchemes: true, schemeRows: 12, colorBySource: true },
    lockedOps: {},
    dispatchPicks: {},
  };
  const sessionStore = { bigResult: { ts: Date.now(), result: ${JSON.stringify(result)} } };
  const listeners = { local: [], session: [] };
  const mk = (store, area) => ({
    get: async (keys) => {
      const ks = keys == null ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of ks) if (k in store) out[k] = store[k];
      return out;
    },
    set: async (obj) => {
      for (const [k, v] of Object.entries(obj)) store[k] = v;
      for (const fn of listeners[area]) fn(Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, { newValue: v }])), area);
    },
    remove: async () => {},
  });
  globalThis.chrome = {
    runtime: {
      getManifest: () => ({ version: "0.0.0-fixture" }),
      getURL: (p) => "/" + p,
      sendMessage: async (msg) => {
        if (msg && msg.type === "DISPATCH_QUERY_STAGE") {
          const code = String(msg.displayCode).toUpperCase();
          return {
            ok: true,
            pool: {
              displayCode: code, stageId: "act3break_fixture", stageName: "夹具关",
              counts: { maa: 2, bili: 1 },
              schemes: [{
                source: "maa", sourceLabel: "MAA作业", displayCode: code, stageName: "夹具关",
                operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }], mode: "单人",
                title: "夹具方案", details: "", author: "fixture", url: "", bvid: "",
                views: 0, hotScore: 0,
              }],
            },
          };
        }
        return { ok: true };
      },
    },
    storage: {
      local: mk(localStore, "local"),
      session: Object.assign(mk(sessionStore, "session"), { setAccessLevel: async () => {} }),
      onChanged: { addListener: (fn) => { listeners.local.push(fn); listeners.session.push(fn); } },
    },
    windows: { create: () => {}, update: () => {}, get: async () => ({}) },
    tabs: { query: async () => [], create: () => {}, update: () => {} },
  };
  window.__store = localStore;
</script>`;

const html = readFileSync(distHtml, "utf8").replace('<script type="module" src="./result.js"></script>', `${stub}\n    <script type="module" src="./result.js"></script>`);
if (!html.includes("window.__store")) throw new Error("注入失败：没找到 result.js 脚本标签");
mkdirSync(join(root, "dist"), { recursive: true });
writeFileSync(join(root, "dist/__fixture-bigwindow.html"), html);
console.log("大窗口夹具已生成：dist/__fixture-bigwindow.html（用 /dist/__fixture-bigwindow.html 访问）");
