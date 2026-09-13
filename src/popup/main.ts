/**
 * Popup 面板：就绪检查 → 获取阵容画面（抓帧/粘贴/文件，可多张）→ 分析 → 渲染 StageResult。
 * 分析任务跑在 background 并持久化到 storage.session：popup 关闭重开后自动恢复状态。
 */

import type { AnalysisOutput, RecommendedSlot, Substitution, TaskState } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface PageContext {
  bvid: string | null;
  page: number | null;
  videoPage: boolean;
}

let capturedImages: string[] = []; // dataURL 列表（编队页 + 助战详情页等）
let currentCtx: PageContext = { bvid: null, page: null, videoPage: false };
let pollTimer: number | undefined;

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
  const { box } = (await chrome.storage.local.get("box")) as { box?: { operators: Record<string, unknown> } };
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const { apiKey } = await chrome.storage.local.get("apiKey");

  const items = [
    currentCtx.videoPage
      ? `<span class="ok">✓</span> 当前在攻略视频页${currentCtx.page ? `（第 ${currentCtx.page} 分P）` : ""}`
      : `<span class="bad">✗</span> 未识别到 BV 号（请在B站视频页使用；若已在视频页，刷新页面后重开插件）`,
    boxCount > 0
      ? `<span class="ok">✓</span> 干员 box 已导入（${boxCount} 名）`
      : `<span class="bad">✗</span> 未导入干员 box`,
    apiKey
      ? `<span class="ok">✓</span> DeepSeek API Key 已配置`
      : `<span class="bad">✗</span> 未配置 DeepSeek API Key`,
  ];
  $("checklist").innerHTML = items.join("<br>");
  updateAnalyzeButton();
}

function updateAnalyzeButton(): void {
  ($("analyzeBtn") as HTMLButtonElement).disabled = capturedImages.length === 0 || !currentCtx.videoPage;
}

function renderPreview(): void {
  const img = $("preview") as HTMLImageElement;
  if (capturedImages.length === 0) {
    img.style.display = "none";
    $("imgCount").textContent = "";
  } else {
    img.src = capturedImages[capturedImages.length - 1]!;
    img.style.display = "block";
    $("imgCount").textContent =
      capturedImages.length === 1 ? "已添加 1 张（可继续追加助战详情页截图）" : `已添加 ${capturedImages.length} 张`;
    $("imgCount").style.display = "block";
  }
  updateAnalyzeButton();
}

function addImage(dataUrl: string): void {
  if (capturedImages.length >= 4) {
    $("status").innerHTML = `<span class="err">最多 4 张截图</span>`;
    return;
  }
  capturedImages.push(dataUrl);
  renderPreview();
  $("status").textContent = "";
}

function clearImages(): void {
  capturedImages = [];
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

/** 压缩图片（截图可能很大，压缩到最大宽 1280 控制 API 流量） */
function shrinkImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxW = 1280;
      if (img.width <= maxW) return resolve(dataUrl);
      const scale = maxW / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = maxW;
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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

function renderSubLine(s: Substitution): string {
  const src = s.source === "pinned" ? "置顶评论" : s.source === "danmaku" ? "弹幕" : "评论区";
  const like = s.likes ? `·${s.likes} 赞` : "";
  const link = s.evidenceUrl ? ` <a href="${esc(s.evidenceUrl)}" target="_blank">溯源</a>` : "";
  return `${esc(s.replacement)}（${src}${like}）${link} <span class="quote">"${esc(s.evidence.slice(0, 50))}"</span>`;
}

function renderSlot(slot: RecommendedSlot): string {
  const op = esc(slot.original.operator);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    const extra = [
      slot.alternatives.length ? `其他可用备选：${slot.alternatives.map(renderSubLine).join("；")}` : "",
      slot.unavailable.length
        ? `<span class="dim">评论还有建议但你暂无对应干员：${slot.unavailable.map((s) => esc(s.replacement)).join("、")}</span>`
        : "",
    ]
      .filter(Boolean)
      .map((s) => `<div class="alts">${s}</div>`)
      .join("");
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <b>${esc(slot.finalOperator!)}</b> <span class="dim">${renderSubLine(slot.via)}</span>` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      extra +
      `</div>`
    );
  }
  const unavail = slot.unavailable.length
    ? `<div class="alts">${slot.unavailable.map(renderSubLine).join("；")}</div>`
    : "";
  return `<div class="slot unresolved">✗ ${op}${keyTag}${supTag} — 无解<div class="note">${esc(slot.note)}</div>${unavail}</div>`;
}

function renderResult(out: AnalysisOutput): void {
  const subCount = out.substitutions.length;
  $("result").innerHTML =
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果（阵容来自画面识别）</div>` +
    `<div class="hint">实战替代建议：${subCount} 条</div>` +
    out.recommendations.map(renderSlot).join("");
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
    if (task.status === "done" && task.result) {
      window.clearInterval(pollTimer!);
      pollTimer = undefined;
      $("status").textContent = "";
      renderResult(task.result);
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

/** popup 重开时恢复后台任务状态 */
async function restoreTask(): Promise<void> {
  const resp = (await chrome.runtime.sendMessage({ type: "GET_TASK" }).catch(() => null)) as
    | { task: TaskState | null }
    | null;
  const task = resp?.task;
  if (!task) return;
  if (task.status === "running" && Date.now() - task.startedAt < 300_000) {
    $("status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-60 秒）";
    pollTask();
  } else if (task.status === "done" && task.result) {
    renderResult(task.result);
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
  await restoreTask();
}

init();
