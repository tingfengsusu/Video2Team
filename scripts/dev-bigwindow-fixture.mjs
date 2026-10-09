/**
 * 开发用夹具（不参与扩展运行）：把 dist/result.html（大窗口结果页）套上 chrome stub 跑起来，
 * 用于复现「大窗口里勾选/渲染不生效」这类问题。
 *
 *   node scripts/dev-bigwindow-fixture.mjs     # 生成 temp/bigwindow-fixture.html
 *   node temp/panel-fixture-server.cjs          # 静态服务（8787）
 *   浏览器打开 http://127.0.0.1:8787/temp/bigwindow-fixture.html
 *
 * 说明：产物放 temp/（页面里的脚本指向 `../dist/result.js`）——**不能**放 dist/：
 * Chrome 加载扩展时遇到以 "_" 开头的文件/目录会直接拒绝整个目录
 * （实测：`__fixture-bigwindow.html` 导致「无法加载清单」）。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const distHtml = join(root, "dist/result.html");
if (!existsSync(distHtml)) throw new Error("请先 npm run build（缺少 dist/result.html）");

// 旧版本把夹具写进 dist/，会让 chrome://extensions「加载已解压的扩展程序」直接失败——顺手清掉
const legacy = join(root, "dist/__fixture-bigwindow.html");
if (existsSync(legacy)) {
  rmSync(legacy);
  console.log("已清理旧夹具 dist/__fixture-bigwindow.html（下划线开头会被 Chrome 拒绝加载）");
}

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
  displayCode: "VEC-SP02", stageId: "act3break_sp02", stageName: "心中热火", counts: { maa: 8, bili: 26, dup: 12 },
  schemes: [
    scheme({ copilotId: 105144 }),
    scheme({ copilotId: 2, operators: ["黑", "机械师"], opers: [{ name: "黑" }, { name: "机械师" }], mode: "双人", title: "黑/机械师双人四号站台" }),
    // 练度表里没有的干员 → 默认被「缺干员」过滤，点「点开查看」能看到（第十三轮 q1 的复现点）
    scheme({ copilotId: 7, operators: ["稀音", "梅尔"], opers: [{ name: "稀音" }, { name: "梅尔" }], mode: "双人", title: "稀音+梅尔 挂机" }),
    bili({}),
  ],
};
// 第二关与 VEC-SP02 共用「凯尔希」：勾选 SP02 的方案后，本关这行要**保留并置灰**（第九轮 q2 的复现点）
const pool2 = {
  displayCode: "VEC-SP07", stageId: "act3break_sp07", stageName: "荒废矿道", counts: { maa: 2, bili: 1 },
  schemes: [
    scheme({ copilotId: 9, displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["凯尔希", "黑"], opers: [{ name: "凯尔希", skill: 3 }, { name: "黑" }], mode: "双人", title: "凯尔希+黑 荒废矿道" }),
    bili({ displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["机械师"], opers: [{ name: "机械师" }], url: "https://www.bilibili.com/video/BV1yy", bvid: "BV1yy", title: "机械师单刷" }),
  ],
};
// 第三关是「关卡链」的后置关：本关需要先打 VEC-SP09（第十一轮 q4 的复现点）
const pool3 = {
  displayCode: "VEC-SP10", stageId: "act3break_sp10", stageName: "后院死局", counts: { maa: 3, bili: 2 },
  schemes: [
    scheme({ copilotId: 11, displayCode: "VEC-SP10", stageName: "后院死局", operators: ["麒麟R夜刀"], opers: [{ name: "麒麟R夜刀", skill: 3 }], mode: "单人", title: "麒麟R夜刀 单人 VEC-SP10" }),
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
  dispatchGuides: [pool, pool2, pool3],
  dispatchStageChain: { "VEC-SP10": "VEC-SP09" },
  dispatchGuideEvidence: {
    "VEC-SP02": "特别战线网格第 5 格 → VEC-SP02，格内文字「催化装备」",
    "VEC-SP07": "特别战线网格第 7 格 → VEC-SP07，格内文字「缴械装备」",
    "VEC-SP10": "特别战线网格第 10 格 → VEC-SP10，格内文字「净血装备」",
  },
  // 「＋ 补一个关…」下拉：只列候选池里还没出现的关；「选择补给关…」浮层用同一份清单
  dispatchStageOptions: [
    { displayCode: "VEC-SP01", stageName: "重力危机" },
    { displayCode: "VEC-SP02", stageName: "心中热火" },
    { displayCode: "VEC-SP07", stageName: "荒废矿道" },
    { displayCode: "VEC-SP09", stageName: "调度中心" },
    { displayCode: "VEC-SP10", stageName: "后院死局" },
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
    box: { operators: { 凯尔希: { name: "凯尔希" }, 黑: { name: "黑" }, 机械师: { name: "机械师" }, 克洛丝: { name: "克洛丝" }, 麒麟R夜刀: { name: "麒麟R夜刀" } }, source: "excel" },
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
        // 「＋ 补一个关…」/「选择补给关…」：夹具里直接返回假方案，便于离线验证「现查并写回」
        if (msg && msg.type === "DISPATCH_QUERY_STAGE") {
          const codes = (Array.isArray(msg.displayCodes) ? msg.displayCodes : [msg.displayCode])
            .map((c) => String(c ?? "").toUpperCase())
            .filter(Boolean);
          const pools = codes.map((code) => ({
            displayCode: code, stageId: "act3break_fixture", stageName: "夹具关",
            counts: { maa: 2, bili: 1 },
            schemes: [{
              source: "maa", sourceLabel: "MAA作业", displayCode: code, stageName: "夹具关",
              operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }], mode: "单人",
              title: "夹具方案", details: "", author: "fixture", url: "", bvid: "",
              views: 0, hotScore: 0,
            }],
          }));
          return { ok: true, pools, pool: pools[0] ?? null };
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

const html = readFileSync(distHtml, "utf8").replace(
  '<script type="module" src="./result.js"></script>',
  `${stub}\n    <script type="module" src="../dist/result.js"></script>`,
);
if (!html.includes("window.__store")) throw new Error("注入失败：没找到 result.js 脚本标签");
mkdirSync(join(root, "temp"), { recursive: true });
writeFileSync(join(root, "temp/bigwindow-fixture.html"), html);
console.log("大窗口夹具已生成：temp/bigwindow-fixture.html（用 http://127.0.0.1:8787/temp/bigwindow-fixture.html 访问）");
