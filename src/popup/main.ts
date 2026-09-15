/**
 * Popup 面板：就绪检查 → 获取阵容画面（抓帧/粘贴/文件，可多张）→ 分析 → 渲染结果。
 * - 分析任务跑在 background 并持久化到 storage.session：popup 关闭重开后自动恢复状态；
 * - 截图列表同样持久化（storage.session.capturedImages），与视频页内浮动面板互通。
 */

import type { AnalysisOutput, Box, TaskState } from "../shared/types";
import { esc, renderResult, type HasOp } from "../shared/render";
import { shrinkImage } from "../shared/img";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

interface PageContext {
  bvid: string | null;
  page: number | null;
  videoPage: boolean;
}

const IMG_KEY = "capturedImages";

let capturedImages: string[] = []; // dataURL 列表（编队页 + 助战详情页等）
let currentCtx: PageContext = { bvid: null, page: null, videoPage: false };
let pollTimer: number | undefined;
let hasOp: HasOp = () => false;
let llmReady = false;

async function getPageContext(): Promise<PageContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ?? "";
  const bvid = url.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = url.match(/[?&]p=(\d+)/);
  let page = p ? parseInt(p[1]!, 10) : null;

  if (bvid) return { bvid, page, videoPage: true };

  // 回退：host/activeTab 权限拿不到 URL 时，问页面内的 content script（它一定能看到 location）
  if (tab?.id) {
    try {
      const resp = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
      if (resp?.bvid) return { bvid: resp.bvid, page: resp.page ?? null, videoPage: true };
    } catch {
      /* content script 未注入（扩展加载前已打开的页面） */
    }
  }
  return { bvid: null, page: null, videoPage: false };
}

async function renderChecklist(): Promise<void> {
  currentCtx = await getPageContext();
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const { llm, apiKey } = (await chrome.storage.local.get(["llm", "apiKey"])) as {
    llm?: { baseUrl?: string; model?: string; mode?: string };
    apiKey?: string;
  };
  const llmReadyNow = llm?.mode === "web" || !!(llm?.baseUrl && llm?.model) || !!apiKey;
  llmReady = llmReadyNow;
  hasOp = (n) => !!box?.operators[n];

  const items = [
    currentCtx.videoPage
      ? `<span class="ok">✓</span> 当前在攻略视频页${currentCtx.page ? `（第 ${currentCtx.page} 分P）` : ""}`
      : `<span class="bad">✗</span> 未识别到 BV 号（请在B站视频页使用；若已在视频页，刷新页面后重开插件）`,
    boxCount > 0
      ? `<span class="ok">✓</span> 干员 box 已导入（${boxCount} 名）`
      : `<span class="bad">✗</span> 未导入干员 box`,
    llmReadyNow
      ? `<span class="ok">✓</span> AI 接口已配置`
      : `<span class="bad">✗</span> 未配置 AI 接口（点下方「设置」）`,
  ];
  $("checklist").innerHTML = items.join("<br>");
  updateAnalyzeButton();
}

function updateAnalyzeButton(): void {
  ($("analyzeBtn") as HTMLButtonElement).disabled =
    capturedImages.length === 0 || !currentCtx.videoPage || !llmReady;
}

async function persistImages(): Promise<void> {
  await chrome.storage.session.set({ [IMG_KEY]: capturedImages });
}

function renderPreview(): void {
  const img = $("preview") as HTMLImageElement;
  const count = $("imgCount");
  const clear = $("clearBtn");
  if (capturedImages.length === 0) {
    img.style.display = "none";
    count.style.display = "none";
    clear.style.display = "none";
  } else {
    img.src = capturedImages[capturedImages.length - 1]!;
    img.style.display = "block";
    count.textContent =
      capturedImages.length === 1 ? "已添加 1 张（可继续追加助战详情页截图）" : `已添加 ${capturedImages.length} 张`;
    count.style.display = "block";
    clear.style.display = "block";
  }
  updateAnalyzeButton();
}

function addImage(dataUrl: string): void {
  if (capturedImages.length >= 4) {
    $("status").innerHTML = `<span class="err">最多 4 张截图</span>`;
    return;
  }
  capturedImages.push(dataUrl);
  void persistImages();
  renderPreview();
  $("status").textContent = "";
}

function clearImages(): void {
  capturedImages = [];
  void persistImages();
  renderPreview();
}

/** 抓取当前视频画面（content script canvas） */
async function grabFrame(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  $("status").textContent = "抓取中…";
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "GRAB_FRAME" });
    if (resp?.ok && resp.dataUrl) {
      addImage(resp.dataUrl);
    } else {
      $("status").innerHTML = `<span class="err">${esc(resp?.reason ?? "抓取失败，请用截图 + Ctrl+V 粘贴")}</span>`;
    }
  } catch {
    $("status").innerHTML = `<span class="err">无法连接页面（请刷新视频页后重试），或直接截图后 Ctrl+V 粘贴</span>`;
  }
}

function wireImageInputs(): void {
  $("grabBtn").addEventListener("click", grabFrame);

  // Ctrl+V 粘贴截图
  document.addEventListener("paste", (e) => {
    const items = (e as ClipboardEvent).clipboardData?.items;
    const imgItem = items ? [...items].find((i) => i.type.startsWith("image/")) : undefined;
    if (!imgItem) return;
    const blob = imgItem.getAsFile();
    if (!blob) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(blob);
  });

  // 文件选择
  $("pickFile").addEventListener("click", (e) => {
    e.preventDefault();
    ($("fileInput") as HTMLInputElement).click();
  });
  $("fileInput").addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addImage(reader.result as string);
    reader.readAsDataURL(file);
  });

  $("clearBtn").addEventListener("click", clearImages);
}

/** 轮询后台任务状态（popup 关闭重开也能恢复） */
function pollTask(): void {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(async () => {
    const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
      | { task: TaskState | null }
      | null;
    const task = resp?.task;
    if (!task) return;
    if (task.status === "running" && task.progress) {
      $("status").textContent = `${task.progress}（约 20-60 秒）`;
    }
    if (task.status === "done" && task.result) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      $("status").textContent = "";
      $("result").innerHTML = renderResult(task.result, hasOp);
    } else if (task.status === "error") {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      $("status").innerHTML = `<span class="err">${esc(task.error ?? "分析失败")}</span>`;
    } else if (Date.now() - task.startedAt > 300_000) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      $("status").innerHTML = `<span class="err">分析超时（5 分钟），请重试</span>`;
    }
  }, 1500);
}

function triggerAnalyze(): void {
  if (!currentCtx.bvid || capturedImages.length === 0) return;
  void (async () => {
    const dataUrls = await Promise.all(capturedImages.map(shrinkImage));
    // fire-and-forget：结果经 storage.session 轮询获取（popup 关闭不丢）
    void chrome.runtime.sendMessage({
      type: "ANALYZE_VIDEO",
      bvid: currentCtx.bvid,
      page: currentCtx.page ?? undefined,
      imageDataUrls: dataUrls,
    });
    $("status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒，可切走稍后回来看）";
    pollTask();
  })();
}

/** popup 重开时恢复：截图列表 + 后台任务状态 */
async function restoreState(): Promise<void> {
  const stored = (await chrome.storage.session.get(IMG_KEY)) as Record<string, string[]>;
  capturedImages = stored[IMG_KEY] ?? [];
  renderPreview();

  const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
    | { task: TaskState | null }
    | null;
  const task = resp?.task;
  if (!task) return;
  if (task.status === "running" && Date.now() - task.startedAt < 300_000) {
    $("status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒）";
    pollTask();
  } else if (task.status === "done" && task.result) {
    $("result").innerHTML = renderResult(task.result, hasOp);
  } else if (task.status === "error" && task.error) {
    $("status").innerHTML = `<span class="err">${esc(task.error)}</span>`;
  }
}

async function init(): Promise<void> {
  await renderChecklist();
  wireImageInputs();
  $("analyzeBtn").addEventListener("click", triggerAnalyze);
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  await restoreState();
}

init();
