/**
 * 结果渲染（纯字符串生成，popup 与 content 页内面板共用）。
 * 着色约定：替代干员在你 box → 绿色(.own)，不在 → 红色(.miss)，用户自行取舍。
 */

import type { AnalysisOutput, RecommendedSlot, Substitution } from "./types";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type HasOp = (name: string) => boolean;

/** 单条实战建议（独立一行）：替代干员名按 box 着色 */
export function renderSubLine(s: Substitution, hasOp: HasOp): string {
  const cls = hasOp(s.replacement) ? "own" : "miss";
  const src = s.source === "pinned" ? "置顶评论" : s.source === "danmaku" ? "弹幕" : "评论区";
  const like = s.likes ? `·${s.likes}赞` : "";
  const link = s.evidenceUrl ? ` <a href="${esc(s.evidenceUrl)}" target="_blank">溯源</a>` : "";
  return `<div class="sub-line"><span class="${cls}">${esc(s.replacement)}</span>（${src}${like}）${link}<span class="quote">“${esc(s.evidence.slice(0, 40))}”</span></div>`;
}

export function renderSlot(slot: RecommendedSlot, hasOp: HasOp): string {
  const op = esc(slot.original.operator);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  const alts = slot.alternatives.length
    ? `<div class="alts">${slot.alternatives.map((s) => renderSubLine(s, hasOp)).join("")}</div>`
    : "";
  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <span class="own"><b>${esc(slot.finalOperator!)}</b></span> <span class="dim">${renderSubLine(slot.via, hasOp)}</span>` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      (alts ? `<div class="alts"><span class="dim">其他实战建议：</span>${alts}</div>` : "") +
      `</div>`
    );
  }
  return (
    `<div class="slot unresolved">✗ ${op}${keyTag}${supTag} — 无解` +
    (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
    (alts ? `<div class="alts"><span class="dim">实战建议：</span>${alts}</div>` : "") +
    `</div>`
  );
}

export function renderResult(out: AnalysisOutput, hasOp: HasOp): string {
  const subCount = out.substitutions.length;
  return (
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果（阵容来自画面识别）</div>` +
    `<div class="hint">实战替代建议：${subCount} 条｜<span class="own">绿=你有</span>／<span class="miss">红=你没有</span></div>` +
    out.recommendations.map((s) => renderSlot(s, hasOp)).join("")
  );
}
