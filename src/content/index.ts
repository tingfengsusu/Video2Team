/**
 * Content Script：
 * 1. 识别B站视频页（BV/分P），供 popup 查询（host 权限不可见 URL 时的回退）；
 * 2. 抓取播放器当前帧（MSE blob 同源，canvas 可绘制）；
 * 3. 视频页浮动入口（右侧 hover 唤起）+ 页内面板：抓帧/粘贴/文件 → 分析 → 结果展示。
 *    页内面板不随点击页面而关闭（popup 的固有问题），且截图与 popup 经
 *    storage.session.capturedImages 互通。
 */

import type { Box, TaskState } from "../shared/types";
import { esc, renderResult, type HasOp } from "../shared/render";
import { shrinkImage } from "../shared/img";

// ---------- 基础能力 ----------

function parseContext(): { bvid: string | null; page: number | null } {
  const bvid = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = new URLSearchParams(location.search).get("p");
  return { bvid, page: p ? parseInt(p, 10) : null };
}

function grabFrameRaw(): { ok: boolean; dataUrl?: string; reason?: string } {
  const video = document.querySelector("video");
  if (!video || !video.videoWidth) {
    return { ok: false, reason: "页面未找到视频画面（请确认视频已开始播放）" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "画布创建失败" };
  ctx.drawImage(video, 0, 0);
  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
  } catch {
    return { ok: false, reason: "画面受保护无法直接抓取，请暂停后用截图 + Ctrl+V 粘贴" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PAGE_CONTEXT") {
    sendResponse(parseContext());
  }
  if (msg?.type === "GRAB_FRAME") {
    sendResponse(grabFrameRaw());
  }
  // B站 API 代理：在页面上下文发请求（Origin=bilibili.com、Cookie/buvid 与正常浏览一致），
  // 绕开 CDN 对扩展后台环境（Origin: chrome-extension://）的风控
  if (msg?.type === "BILI_FETCH" && typeof msg.url === "string") {
    fetch(msg.url, { credentials: "include" })
      .then(async (r) => sendResponse({ ok: true, status: r.status, text: await r.text() }))
      .catch((err: Error) => sendResponse({ ok: false, status: 0, text: err.message }));
    return true;
  }
});

// ---------- 浮动入口 + 页内面板 ----------

const IMG_KEY = "capturedImages";
const host = document.createElement("div");
host.id = "video2team-host";
let shadow: ShadowRoot | null = null;
let panelOpen = false;
let images: string[] = [];
/** 默认按「没有」处理（更保守，不会误报拥有）；openPanel 时从 localStorage box 加载真实判断 */
let hasOp: HasOp = () => false;
let pollTimer: number | undefined;

const STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: system-ui, "Microsoft YaHei", sans-serif; }

  /* 右缘 hover 感应区：鼠标移入滑出按钮 */
  .hoverzone {
    position: fixed; right: 0; top: 38%; width: 22px; height: 180px; z-index: 2147483646;
  }
  .fab {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%) translateX(120%);
    writing-mode: vertical-rl; letter-spacing: 4px;
    padding: 10px 8px; font-size: 13px; cursor: pointer; white-space: nowrap;
    background: #23ade5; color: #fff; border: none; border-radius: 10px 0 0 10px;
    box-shadow: -2px 2px 8px rgba(0,0,0,.25);
    transition: transform .18s ease; opacity: 0; pointer-events: none;
  }
  .hoverzone:hover .fab { transform: translateY(-50%) translateX(0); opacity: 1; pointer-events: auto; }

  /* 页内面板 */
  .panel {
    position: fixed; right: 14px; top: 70px; width: 380px; max-height: 82vh; overflow-y: auto;
    background: #fff; border-radius: 12px; padding: 14px;
    box-shadow: 0 6px 24px rgba(0,0,0,.18); z-index: 2147483647; display: none;
  }
  .panel.open { display: block; }
  h1 { font-size: 15px; margin: 0 0 2px; }
  .tagline { font-size: 11px; color: #888; margin-bottom: 8px; }
  .close { position: absolute; right: 10px; top: 8px; border: none; background: none;
           font-size: 16px; cursor: pointer; color: #999; }
  .settings { border: none; background: #f0f3f5; border: 1px solid #d0d7de; border-radius: 6px;
              font-size: 12px; padding: 4px 10px; cursor: pointer; color: #333; margin-bottom: 6px; }
  .readiness .ok { color: #1a7f37; }
  .readiness .bad { color: #c0392b; }
  button.act { margin: 4px 0; padding: 7px 12px; font-size: 13px; cursor: pointer;
           border: none; border-radius: 6px; background: #23ade5; color: #fff; }
  button.act:disabled { background: #aaa; cursor: not-allowed; }
  button.ghost { background: #f0f3f5; color: #333; border: 1px solid #d0d7de; }
  .hint { font-size: 11px; color: #888; line-height: 1.6; }
  .zone { border: 1.5px dashed #c8d0d6; border-radius: 8px; padding: 8px; text-align: center; margin: 6px 0; }
  .thumbs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .thumb { position: relative; width: 82px; }
  .thumb img { width: 82px; height: 46px; object-fit: cover; border-radius: 4px; display: block; }
  .thumb .rm { position: absolute; top: -6px; right: -6px; width: 16px; height: 16px; line-height: 15px;
               text-align: center; background: #c0392b; color: #fff; border-radius: 50%;
               font-size: 11px; cursor: pointer; }
  #status { font-size: 12px; color: #666; margin: 6px 0; }
  .video-title { font-size: 12px; color: #555; margin: 6px 0; }
  .stage { font-size: 14px; font-weight: bold; margin: 8px 0 4px; }
  .slot { font-size: 13px; line-height: 1.5; padding: 4px 8px; border-radius: 4px; margin-bottom: 3px;
          background: #fafbfc; border-left: 3px solid #d0d7de; }
  .keep { border-left-color: #1a7f37; }
  .sub { border-left-color: #d29922; }
  .unresolved { border-left-color: #c0392b; }
  .slot .note { color: #c0392b; font-size: 12px; }
  .slot a, a.link { color: #23ade5; text-decoration: none; font-size: 12px; }
  .slot .alts { font-size: 12px; color: #555; margin-top: 2px; }
  .sub-line { display: block; line-height: 1.7; }
  .own { color: #1a7f37; font-weight: 700; }
  .miss { color: #c0392b; font-weight: 700; }
  .quote { color: #999; }
  .dim { color: #888; font-size: 12px; }
  .err { font-size: 13px; color: #c0392b; }
`;

const PANEL_HTML = `
  <div class="hoverzone"><button class="fab">🎮 阵容适配</button></div>
  <div class="panel">
    <button class="close" title="收起">✕</button>
    <h1>🎮 Video2Team</h1>
    <div class="tagline">把大佬的作业，改成你抄得动的作业</div>
    <div class="readiness hint" style="margin-bottom:6px"></div>
    <button class="settings" data-act="settings" title="设置 API Key / 导入练度表">⚙ 设置</button>

    <div class="zone">
      <button class="act" data-act="grab">📷 抓取当前画面</button>
      <div class="hint">暂停在<strong>编队/阵容画面</strong>后抓帧；或 <strong>Ctrl+V 粘贴</strong> / <button class="link" data-act="pick" style="border:none;background:none;cursor:pointer;padding:0;font-size:11px;color:#23ade5">选择文件</button>（可多张，如助战详情页）</div>
      <input type="file" accept="image/*" style="display:none" />
      <div class="thumbs"></div>
      <div class="hint count" style="margin-top:4px"></div>
    </div>

    <button class="act" data-act="analyze" disabled>分析此关卡</button>
    <button class="act ghost" data-act="clear" style="display:none">清除全部截图</button>
    <div id="status"></div>
    <div id="result"></div>
  </div>
`;

function q<T extends Element = Element>(sel: string): T {
  return shadow!.querySelector(sel)! as T;
}

async function persistImages(): Promise<void> {
  try {
    await chrome.storage.session.set({ [IMG_KEY]: images });
  } catch {
    /* session 不可用（权限/上下文）时静默：截图仅本次面板有效 */
  }
}

async function readImages(): Promise<string[]> {
  try {
    const stored = (await chrome.storage.session.get(IMG_KEY)) as Record<string, string[]>;
    return stored[IMG_KEY] ?? [];
  } catch {
    return images;
  }
}

async function loadBox(): Promise<void> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  hasOp = (n) => !!box?.operators[n];
}

/** 面板头部就绪状态：box / API Key（缺项红字提示去设置） */
async function renderReadiness(): Promise<void> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  const { apiKey } = await chrome.storage.local.get("apiKey");
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const el = q(".readiness");
  el.innerHTML =
    (boxCount > 0
      ? `<span class="ok">✓ 练度表 ${boxCount} 人</span>`
      : `<span class="bad">✗ 未导入练度表</span>`) +
    " ｜ " +
    (apiKey ? `<span class="ok">✓ API Key</span>` : `<span class="bad">✗ 未配置 API Key</span>`) +
    " ｜ <span style='color:#888'>点「⚙ 设置」配置</span>";
}

function renderThumbs(): void {
  const wrap = q(".thumbs");
  wrap.innerHTML = images
    .map(
      (u, i) =>
        `<div class="thumb"><img src="${u}"><span class="rm" data-i="${i}" title="移除">✕</span></div>`,
    )
    .join("");
  const count = q<HTMLDivElement>(".count");
  const clearBtn = q<HTMLButtonElement>('[data-act="clear"]');
  count.textContent =
    images.length === 0 ? "" : images.length === 1 ? "已添加 1 张（可追加助战详情页）" : `已添加 ${images.length} 张`;
  clearBtn.style.display = images.length ? "" : "none";
  (q<HTMLButtonElement>('[data-act="analyze"]') as HTMLButtonElement).disabled = images.length === 0;
}

function addImage(dataUrl: string): void {
  if (images.length >= 4) {
    q("#status").innerHTML = `<span class="err">最多 4 张截图</span>`;
    return;
  }
  images.push(dataUrl);
  void persistImages();
  renderThumbs();
  q("#status").textContent = "";
}

async function grabFrame(): Promise<void> {
  q("#status").textContent = "抓取中…";
  const r = grabFrameRaw();
  if (r.ok && r.dataUrl) {
    addImage(r.dataUrl);
  } else {
    q("#status").innerHTML = `<span class="err">${esc(r.reason ?? "抓取失败，请截图后 Ctrl+V 粘贴")}</span>`;
  }
}

function pollTask(): void {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
      | { task: TaskState | null }
      | null;
    const task = resp?.task;
    if (!task) return;
    if (task.status === "running" && task.progress) {
      q("#status").textContent = `${task.progress}（约 20-60 秒）`;
    }
    if (task.status === "done" && task.result) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      q("#status").textContent = "";
      q("#result").innerHTML = renderResult(task.result, hasOp);
    } else if (task.status === "error") {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      q("#status").innerHTML = `<span class="err">${esc(task.error ?? "分析失败")}</span>`;
    } else if (Date.now() - task.startedAt > 300_000) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      q("#status").innerHTML = `<span class="err">分析超时（5 分钟），请重试</span>`;
    }
  }, 1500);
}

async function triggerAnalyze(): Promise<void> {
  const { bvid, page } = parseContext();
  if (!bvid || images.length === 0) return;
  const dataUrls = await Promise.all(images.map(shrinkImage));
  void chrome.runtime.sendMessage({
    type: "ANALYZE_VIDEO",
    bvid,
    page: page ?? undefined,
    imageDataUrls: dataUrls,
  });
  q("#status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒，面板可收起稍后回来看）";
  pollTask();
}

async function openPanel(): Promise<void> {
  panelOpen = true;
  q(".panel").classList.add("open");
  // 先加载 box（local storage，内容脚本恒可访问）——决定红绿着色的 hasOp
  await loadBox();
  await renderReadiness();
  images = await readImages();
  renderThumbs();
  // 恢复后台任务状态
  const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
    | { task: TaskState | null }
    | null;
  const task = resp?.task;
  if (task?.status === "running" && Date.now() - task.startedAt < 300_000) {
    q("#status").textContent = "分析中…（约 20-60 秒）";
    pollTask();
  } else if (task?.status === "done" && task.result) {
    q("#result").innerHTML = renderResult(task.result, hasOp);
  } else if (task?.status === "error" && task.error) {
    q("#status").innerHTML = `<span class="err">${esc(task.error)}</span>`;
  }
}

function closePanel(): void {
  panelOpen = false;
  q(".panel").classList.remove("open");
}

function mount(): void {
  if (shadow) return;
  shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const root = document.createElement("div");
  root.innerHTML = PANEL_HTML;
  shadow.append(style, root);

  q(".fab").addEventListener("click", () => void openPanel());
  q(".close").addEventListener("click", closePanel);
  q('[data-act="grab"]').addEventListener("click", () => void grabFrame());
  q('[data-act="analyze"]').addEventListener("click", () => void triggerAnalyze());
  q('[data-act="clear"]').addEventListener("click", () => {
    images = [];
    void persistImages();
    renderThumbs();
  });
  q('[data-act="settings"]').addEventListener("click", () => {
    void chrome.runtime.sendMessage({ type: "OPEN_OPTIONS" });
  });
  q('[data-act="pick"]').addEventListener("click", () => q<HTMLInputElement>("input[type=file]").click());
  q<HTMLInputElement>("input[type=file]").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(file);
  });
  // 缩略图移除（事件委托）
  q(".thumbs").addEventListener("click", (e) => {
    const rm = (e.target as HTMLElement).closest(".rm");
    if (!rm) return;
    const i = parseInt(rm.getAttribute("data-i") ?? "", 10);
    if (Number.isInteger(i)) {
      images.splice(i, 1);
      void persistImages();
      renderThumbs();
    }
  });
  // Ctrl+V 粘贴（仅面板打开时）
  document.addEventListener("paste", (e) => {
    if (!panelOpen) return;
    const items = (e as ClipboardEvent).clipboardData?.items;
    const imgItem = items ? [...items].find((i) => i.type.startsWith("image/")) : undefined;
    if (!imgItem) return;
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(blob);
  });
  // popup 侧改动截图时同步（互通）
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[IMG_KEY] && panelOpen) {
      images = (changes[IMG_KEY].newValue as string[] | undefined) ?? [];
      renderThumbs();
    }
  });

  document.documentElement.appendChild(host);
}

// SPA 导航：URL 变化时挂载/卸载（B站是单页应用）
function syncVisibility(): void {
  const on = !!location.pathname.match(/\/video\//);
  if (on) mount();
  if (shadow) host.style.display = on ? "" : "none";
}
setInterval(syncVisibility, 1000);
syncVisibility();
