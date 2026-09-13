/**
 * Popup 面板：就绪检查（视频页/box/API key）→ 触发分析 → 渲染 StageResult。
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

async function renderChecklist(): Promise<{ bvid: string | null; page: number | null; ready: boolean }> {
  const ctx = await getPageContext();
  const { box } = (await chrome.storage.local.get("box")) as { box?: { operators: Record<string, unknown> } };
  const boxCount = box?.operators ? Object.keys(box.operators).length : 0;
  const { apiKey } = await chrome.storage.local.get("apiKey");

  const items = [
    ctx.videoPage
      ? `<span class="ok">✓</span> 当前在攻略视频页${ctx.page ? `（第 ${ctx.page} 分P）` : ""}`
      : `<span class="bad">✗</span> 未识别到 BV 号（请在B站视频页使用；若已在视频页，刷新页面后重开插件）`,
    boxCount > 0
      ? `<span class="ok">✓</span> 干员 box 已导入（${boxCount} 名）`
      : `<span class="bad">✗</span> 未导入干员 box`,
    apiKey
      ? `<span class="ok">✓</span> DeepSeek API Key 已配置`
      : `<span class="bad">✗</span> 未配置 DeepSeek API Key`,
  ];
  $("checklist").innerHTML = items.join("<br>");
  return { bvid: ctx.bvid, page: ctx.page, ready: ctx.videoPage && boxCount > 0 && !!apiKey };
}

function renderSlot(slot: RecommendedSlot): string {
  const op = esc(slot.original.operator);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    const via = slot.via;
    const src = via.source === "pinned" ? "置顶评论" : "评论区";
    const kindLabel =
      slot.kind === "skill_swap" ? "换技能" : slot.kind === "position_swap" ? "换位置" : slot.kind === "manual" ? "改手动" : "";
    const detail = `${src}建议${kindLabel ? `(${kindLabel})` : ""}${via.likes ? `·${via.likes} 赞` : ""}`;
    const ev = esc(via.evidence.slice(0, 60));
    const link = slot.evidenceUrl ? ` <a href="${esc(slot.evidenceUrl)}" target="_blank">溯源</a>` : "";
    return (
      `<div class="slot sub">⚠ ${op}${keyTag} → <b>${esc(slot.finalOperator!)}</b>（${detail}）${link}` +
      `<div class="note">"${ev}"</div>` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      `</div>`
    );
  }
  return `<div class="slot unresolved">✗ ${op}${keyTag} — 无解<div class="note">${esc(slot.note)}</div></div>`;
}

function renderResult(out: AnalysisOutput): void {
  const srcLabel =
    out.roster.source === "pinned_comment"
      ? "来自置顶评论"
      : "来自视频简介（可能不含本关全部干员，仅供参考）";
  const subCount = out.substitutions.length;
  $("result").innerHTML =
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果</div>` +
    `<div class="roster-src">阵容来源：${srcLabel}｜实战替代建议：${subCount} 条</div>` +
    out.recommendations.map(renderSlot).join("");
}

async function analyze(bvid: string, page: number | null): Promise<void> {
  const btn = $("analyzeBtn") as HTMLButtonElement;
  $("status").textContent = "分析中：提取阵容 → 挖掘评论区 → 匹配你的 box…（约 10-30 秒）";
  btn.disabled = true;
  try {
    const resp = (await chrome.runtime.sendMessage({ type: "ANALYZE_VIDEO", bvid, page: page ?? undefined })) as
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
    btn.disabled = false;
  }
}

async function init(): Promise<void> {
  const { bvid, page, ready } = await renderChecklist();
  ($("analyzeBtn") as HTMLButtonElement).disabled = !ready;
  ($("analyzeBtn") as HTMLButtonElement).addEventListener("click", () => bvid && analyze(bvid, page));
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
}

init();
