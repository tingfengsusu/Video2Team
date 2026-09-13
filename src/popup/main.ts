/**
 * Popup 面板：就绪检查 → 获取阵容画面（抓帧/粘贴/文件）→ 分析 → 渲染 StageResult。
 * 阵容必须来自画面（设计 §4.1）：无图时「分析此关卡」保持禁用并引导。
 */

import type { AnalysisOutput, RecommendedSlot } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface PageContext {
  bvid: string | null;
  page: number | null;
  videoPage: boolean;
}

let capturedImage: string | null = null; // dataURL
let currentCtx: PageContext = { bvid: null, page: null, videoPage: false };

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
  ($("analyzeBtn") as HTMLButtonElement).disabled = !capturedImage || !currentCtx.videoPage;
}

function setImage(dataUrl: string): void {
  capturedImage = dataUrl;
  const img = $("preview") as HTMLImageElement;
  img.src = dataUrl;
  img.style.display = "block";
  updateAnalyzeButton();
  $("status").textContent = "";
}

/** 抓取当前视频画面（content script canvas） */
async function grabFrame(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  $("status").textContent = "抓取中…";
  try {
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "GRAB_FRAME" });
    if (resp?.ok && resp.dataUrl) {
      setImage(resp.dataUrl);
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
    reader.onload = () => setImage(reader.result as string);
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
    reader.onload = () => setImage(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function renderSlot(slot: RecommendedSlot): string {
  const op = esc(slot.original.operator);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    const via = slot.via;
    const src = via.source === "pinned" ? "置顶评论" : via.source === "danmaku" ? "弹幕" : "评论区";
    const kindLabel =
      slot.kind === "skill_swap" ? "换技能" : slot.kind === "position_swap" ? "换位置" : slot.kind === "manual" ? "改手动" : "";
    const detail = `${src}建议${kindLabel ? `(${kindLabel})` : ""}${via.likes ? `·${via.likes} 赞` : ""}`;
    const ev = esc(via.evidence.slice(0, 60));
    const link = slot.evidenceUrl ? ` <a href="${esc(slot.evidenceUrl)}" target="_blank">溯源</a>` : "";
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <b>${esc(slot.finalOperator!)}</b>（${detail}）${link}` +
      `<div class="note">"${ev}"</div>` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      `</div>`
    );
  }
  return `<div class="slot unresolved">✗ ${op}${keyTag}${supTag} — 无解<div class="note">${esc(slot.note)}</div></div>`;
}

function renderResult(out: AnalysisOutput): void {
  const subCount = out.substitutions.length;
  $("result").innerHTML =
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果（阵容来自画面识别）</div>` +
    `<div class="hint">实战替代建议：${subCount} 条</div>` +
    out.recommendations.map(renderSlot).join("");
}

async function analyze(bvid: string, page: number | null): Promise<void> {
  const btn = $("analyzeBtn") as HTMLButtonElement;
  $("status").textContent = "分析中：识别画面阵容 → 挖掘弹幕/评论区 → 匹配你的 box…（约 20-40 秒）";
  btn.disabled = true;
  try {
    const dataUrl = capturedImage ? await shrinkImage(capturedImage) : "";
    const resp = (await chrome.runtime.sendMessage({
      type: "ANALYZE_VIDEO",
      bvid,
      page: page ?? undefined,
      imageDataUrl: dataUrl,
    })) as
      | { ok: true; result: AnalysisOutput }
      | { ok: false; error: string }
      | undefined;
    if (!resp) throw new Error("扩展后台未响应：请到扩展管理页重新加载本扩展后重试");
    if (!resp.ok) throw new Error(resp.error);
    renderResult(resp.result);
    $("status").textContent = "";
  } catch (err) {
    $("status").innerHTML = `<span class="err">${esc((err as Error).message)}</span>`;
  } finally {
    updateAnalyzeButton();
  }
}

async function init(): Promise<void> {
  await renderChecklist();
  wireImageInputs();
  $("analyzeBtn").addEventListener("click", () => {
    if (currentCtx.bvid && capturedImage) analyze(currentCtx.bvid, currentCtx.page);
  });
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
