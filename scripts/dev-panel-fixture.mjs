/**
 * 开发用夹具（不参与扩展运行）：生成一个「假B站视频页 + stub chrome + 真实 dist/content.js」的页面，
 * 用来在浏览器里端到端复现面板相关的问题（勾选不生效、渲染异常、事件链断裂等），
 * 也用来出**宣传帖截图**（页面外观照着 B站视频页做的，截图拿得出手）。
 *
 *   node scripts/dev-panel-fixture.mjs
 *   node temp/panel-fixture-server.cjs        # 起静态服务（8787）
 *   浏览器打开 http://127.0.0.1:8787/video/BV1TEST?p=2
 *
 * 页面里预置了 storage.local：box（练度表）、advanced、lockedOps/dispatchPicks（占用与勾选）、
 * resultCache（一份完整分析结果），因此面板打开时会走「上次分析」路径渲染候选池——
 * 与用户实测场景一致（含派遣关候选池、关卡链、占用置灰、缺干员可点开查看）。
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
  displayCode: "VEC-SP02", stageId: "act3break_sp02", stageName: "心中热火", counts: { maa: 8, bili: 26, dup: 12 },
  schemes: [
    scheme({ copilotId: 105144 }),
    scheme({ copilotId: 2, operators: ["黑", "机械师"], opers: [{ name: "黑" }, { name: "机械师" }], mode: "双人", title: "黑/机械师双人四号站台" }),
    scheme({ copilotId: 7, operators: ["稀音", "梅尔"], opers: [{ name: "稀音" }, { name: "梅尔" }], mode: "双人", title: "稀音+梅尔 挂机" }),
    bili({}),
    bili({ operators: ["提丰", "早露"], opers: [{ name: "提丰" }, { name: "早露" }], mode: "双人", title: "VEC-SP02 双人低配", url: "https://www.bilibili.com/video/BV1EqaH6gEAX?p=12", bvid: "BV1EqaH6gEAX", page: 12, collection: "VEC-SP01~14 矢量突破#3 特别战线合集" }),
  ],
};
// 第二关与 VEC-SP02 共用「凯尔希」：勾选 SP02 后本关这行要**保留并置灰**（跨关取舍）
const pool2 = {
  displayCode: "VEC-SP07", stageId: "act3break_sp07", stageName: "荒废矿道", counts: { maa: 2, bili: 6, dup: 3 },
  schemes: [
    scheme({ copilotId: 9, displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["凯尔希", "史尔特尔"], opers: [{ name: "凯尔希", skill: 3 }, { name: "史尔特尔", skill: 3 }], mode: "双人", title: "凯尔希+42 荒废矿道" }),
    bili({ displayCode: "VEC-SP07", stageName: "荒废矿道", operators: ["机械师"], opers: [{ name: "机械师" }], url: "https://www.bilibili.com/video/BV1yy", bvid: "BV1yy", title: "机械师单刷" }),
  ],
};
// 第三关是「关卡链」的后置关：本关需要先打 VEC-SP09
const pool3 = {
  displayCode: "VEC-SP10", stageId: "act3break_sp10", stageName: "后院死局", counts: { maa: 3, bili: 2 },
  schemes: [
    scheme({ copilotId: 11, displayCode: "VEC-SP10", stageName: "后院死局", operators: ["麒麟R夜刀"], opers: [{ name: "麒麟R夜刀", skill: 3 }], mode: "单人", title: "麒麟R夜刀 单人 VEC-SP10" }),
  ],
};
const result = {
  roster: {
    stage: "VEC-C", videoId: "BV1TEST", page: 2, source: "screenshot",
    slots: [{ operator: "凯尔希", isKey: true }, { operator: "能天使", support: true }, { operator: "令" }, { operator: "泥岩" }, { operator: "克洛丝" }, { operator: "遥" }],
  },
  substitutions: [
    { removed: "泥岩", replacement: "星熊", stage: "VEC-C", evidence: "没有泥岩可以用星熊顶，注意技能", source: "comment", kind: "operator_swap", likes: 18, verified: true },
    { removed: "令", replacement: "余", stage: "VEC-C", evidence: "令可以换成余，练度够就行", source: "danmaku", kind: "operator_swap", likes: 6, verified: true },
  ],
  recommendations: [
    { original: { operator: "凯尔希", isKey: true }, finalOperator: "凯尔希", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "能天使" }, finalOperator: "能天使", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "令" }, finalOperator: null, status: "unresolved", via: null, alternatives: [{ removed: "令", replacement: "余", stage: "VEC-C", evidence: "令可以换成余，练度够就行", source: "danmaku", kind: "operator_swap", likes: 6, verified: true }], risk: "high", evidenceUrl: "", note: "未找到可靠替代，建议回评论区确认" },
    { original: { operator: "泥岩" }, finalOperator: "星熊", status: "substituted", kind: "operator_swap", via: { removed: "泥岩", replacement: "星熊", stage: "VEC-C", evidence: "没有泥岩可以用星熊顶，注意技能", source: "comment", kind: "operator_swap", likes: 18, verified: true }, alternatives: [], risk: "medium", evidenceUrl: "", note: "关键位替换，注意开局费用" },
    { original: { operator: "克洛丝" }, finalOperator: "克洛丝", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
    { original: { operator: "遥" }, finalOperator: "遥", status: "keep", via: null, alternatives: [], risk: "low", evidenceUrl: "", note: "" },
  ],
  videoTitle: "【矢量突破#3】拟生态 全关卡 摆完挂机 简单好抄（特别战线 VEC-SP 系列）",
  stage: "VEC-C（全力以赴）", bvid: "BV1TEST", stageCode: "VEC-C",
  dispatchGuides: [pool, pool2, pool3],
  dispatchStageChain: { "VEC-SP10": "VEC-SP09" },
  dispatchGuideEvidence: {
    "VEC-SP02": "特别战线网格第 5 格 → VEC-SP02，格内文字「催化装备」",
    "VEC-SP07": "特别战线网格第 7 格 → VEC-SP07，格内文字「缴械装备」",
    "VEC-SP10": "特别战线网格第 10 格 → VEC-SP10，格内文字「净血装备」",
  },
  dispatchStageOptions: [
    { displayCode: "VEC-SP01", stageName: "重力危机" },
    { displayCode: "VEC-SP02", stageName: "心中热火" },
    { displayCode: "VEC-SP07", stageName: "荒废矿道" },
    { displayCode: "VEC-SP09", stageName: "调度中心" },
    { displayCode: "VEC-SP10", stageName: "后院死局" },
    { displayCode: "VEC-SP12", stageName: "四号站台" },
  ],
  dispatchGuideNote: "B站挖掘：3 关 · 命中 12 条（缓存 3 关）｜ 去重 15 条（与 MAA 同阵容）、过滤 158 条（合集或其它关卡）、忽略 7 条（超出 180 天）",
  stats: { danmakuTotal: 320, commentCandidates: 42, danmakuCandidates: 18 },
};
const box = {
  凯尔希: { name: "凯尔希" }, 能天使: { name: "能天使" }, 令: { name: "令" }, 泥岩: { name: "泥岩" },
  克洛丝: { name: "克洛丝" }, 遥: { name: "遥" }, 黑: { name: "黑" }, 机械师: { name: "机械师" },
  麒麟R夜刀: { name: "麒麟R夜刀" }, 史尔特尔: { name: "史尔特尔" },
};
const lockedOps = { 凯尔希: "VEC-SP02（心中热火）", 能天使: "VEC-SP02（心中热火）" };
const picks = { "VEC-SP02": { key: "maa:105144", label: "VEC-SP02（心中热火）", ops: ["凯尔希", "能天使"] } };

const page = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>【矢量突破#3】拟生态 全关卡 摆完挂机 简单好抄_哔哩哔哩_bilibili</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, "Microsoft YaHei", sans-serif; background: #f6f7f8; color: #18191c; }
  header { height: 56px; background: #fff; display: flex; align-items: center; gap: 16px; padding: 0 24px;
           border-bottom: 1px solid #e3e5e7; font-size: 14px; }
  header .logo { color: #00aeec; font-weight: 700; font-size: 18px; }
  header .nav { display: flex; gap: 16px; color: #61666d; }
  header .search { flex: 1; max-width: 460px; height: 34px; border-radius: 17px; background: #f1f2f3;
                   display: flex; align-items: center; padding: 0 14px; color: #9499a0; font-size: 13px; }
  main { max-width: 1120px; margin: 16px auto; padding: 0 16px; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; }
  .player { position: relative; width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 8px; overflow: hidden; }
  .player video { width: 100%; height: 100%; object-fit: contain; }
  h1 { font-size: 18px; line-height: 1.5; margin: 12px 0 8px; }
  .meta { display: flex; align-items: center; gap: 12px; font-size: 13px; color: #61666d; padding-bottom: 12px; border-bottom: 1px solid #e3e5e7; }
  .avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #00aeec, #7b61ff); }
  .desc { background: #fff; border-radius: 8px; padding: 12px 14px; margin-top: 12px; font-size: 13px; line-height: 1.8; color: #61666d; }
  .desc b { color: #18191c; }
  .comments { background: #fff; border-radius: 8px; padding: 12px 14px; margin-top: 12px; font-size: 13px; }
  .comments h3 { font-size: 15px; margin: 0 0 10px; }
  .c { padding: 8px 0; border-bottom: 1px dashed #f1f2f3; line-height: 1.7; }
  .c b { color: #00aeec; font-weight: 600; margin-right: 6px; }
  .c .like { color: #9499a0; font-size: 12px; margin-left: 8px; }
  aside { display: flex; flex-direction: column; gap: 12px; }
  .rec { display: flex; gap: 8px; background: #fff; border-radius: 8px; padding: 8px; }
  .rec .thumb { width: 120px; height: 68px; border-radius: 6px; background: #e3e5e7; flex: none; }
  .rec .t { font-size: 13px; line-height: 1.5; color: #18191c; }
  .rec .s { font-size: 12px; color: #9499a0; margin-top: 4px; }
  #boot, #errors { position: fixed; left: 8px; bottom: 6px; margin: 0; font-size: 11px; color: #b0b6bd; }
  #errors { color: #c0392b; bottom: 22px; }
</style></head>
<body>
  <header>
    <span class="logo">bilibili</span>
    <span class="nav"><span>首页</span><span>番剧</span><span>直播</span><span>游戏中心</span><span>会员购</span></span>
    <span class="search">搜索：矢量突破 特别战线</span>
  </header>
  <main>
    <div>
      <div class="player"><video id="v" muted></video></div>
      <h1>【矢量突破#3】拟生态 全关卡 摆完挂机 简单好抄（特别战线 VEC-SP 系列）</h1>
      <div class="meta">
        <span class="avatar"></span>
        <span>攻略UP主</span>
        <span>· 12.3万播放 · 2026-10-09 12:30:00</span>
        <span style="margin-left:auto">点赞 1.2万 · 投币 3421 · 收藏 8765</span>
      </div>
      <div class="desc">
        <b>简介：</b>本期把特别战线 VEC-SP01~SP12 全部摆完挂机，缺干员的地方都在评论区补了替代。<br>
        阵容练度够就能抄，关键位在视频里标注了；<b>特别战线</b>里先打前置关（比如 SP10 要先打 SP09），把占用算进去别撞车。
      </div>
      <div class="comments">
        <h3>评论 320</h3>
        <div class="c"><b>甲</b>没有泥岩可以用星熊顶，注意技能<span class="like">18 赞</span></div>
        <div class="c"><b>乙</b>令可以换成余，练度够就行<span class="like">6 赞</span></div>
        <div class="c"><b>丙</b>麒麟R夜刀单人也能过，我试了<span class="like">9 赞</span></div>
        <div class="c"><b>丁</b>问一下 SP12 四号站台用谁比较稳<span class="like">3 赞</span></div>
      </div>
    </div>
    <aside>
      <div class="rec"><div class="thumb"></div><div><div class="t">【矢量突破#3】特别战线 SP01~SP16 低配合集</div><div class="s">攻略UP主 · 8.1万播放</div></div></div>
      <div class="rec"><div class="thumb"></div><div><div class="t">VEC-C 全力以赴 挂机 四人</div><div class="s">作业UP · 3.4万播放</div></div></div>
      <div class="rec"><div class="thumb"></div><div><div class="t">矢量突破#3 拟生态 全关卡 摆完挂机</div><div class="s">另一个UP · 12.3万播放</div></div></div>
      <div class="rec"><div class="thumb"></div><div><div class="t">特别战线补给怎么选？一张图看懂</div><div class="s">数据UP · 5.6万播放</div></div></div>
    </aside>
  </main>
  <pre id="boot">booting…</pre>
  <pre id="errors"></pre>
<script>
  const errors = [];
  window.addEventListener("error", (e) => errors.push("error: " + e.message + " @" + e.lineno));
  window.addEventListener("unhandledrejection", (e) => errors.push("rejection: " + (e.reason && e.reason.message ? e.reason.message : String(e.reason))));
  const store = {
    box: { operators: ${JSON.stringify(box)}, source: "excel" },
    advanced: { hideUnavailableSchemes: true, schemeRows: 12, colorBySource: true },
    lockedOps: ${JSON.stringify(lockedOps)},
    dispatchPicks: ${JSON.stringify(picks)},
    resultCache: { "BV1TEST:2": { ts: Date.now(), result: ${JSON.stringify(result)} } },
  };
  const listeners = [];
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async (msg) => {
        if (msg && msg.type === "GET_TASK") return { task: null };
        if (msg && msg.type === "DISPATCH_QUERY_STAGE") {
          const codes = Array.isArray(msg.displayCodes) ? msg.displayCodes : [msg.displayCode];
          const pools = codes.map((c) => ({
            displayCode: String(c).toUpperCase(), stageId: "act3break_fixture", stageName: "夹具关",
            counts: { maa: 2, bili: 1 },
            schemes: [{
              source: "maa", sourceLabel: "MAA作业", displayCode: String(c).toUpperCase(),
              stageName: "夹具关", operators: ["凯尔希"], opers: [{ name: "凯尔希", skill: 3 }],
              mode: "单人", title: "夹具方案", details: "", author: "fixture", url: "", bvid: "",
              views: 0, hotScore: 0,
            }],
          }));
          return { ok: true, pools, pool: pools[0] ?? null };
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
