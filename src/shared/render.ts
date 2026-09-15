/**
 * 结果渲染（纯字符串生成，popup 与 content 页内面板共用）。
 *
 * 着色约定（用户要求，2026-09-13）：**干员名字体颜色** = 是否在你 box：
 * 绿色(.own) = 你有，红色(.miss) = 你没有。背景不做红绿（避免混淆），
 * 状态仅用左侧色条区分（保留/替换/无解）。
 */

import type { AnalysisOutput, RecommendedSlot, Substitution } from "./types";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type HasOp = (name: string) => boolean;

/** 内联样式（优先级最高，不依赖 CSS 类是否加载/更新） */
const OWN_STYLE = "color:#1a7f37;font-weight:700";
const MISS_STYLE = "color:#c0392b;font-weight:700";

/** 干员名（按是否持有着色——内联样式，绿=你有 红=你没有） */
function nameSpan(name: string, hasOp: HasOp): string {
  const owned = hasOp(name);
  return `<span class="${owned ? "own" : "miss"}" style="${owned ? OWN_STYLE : MISS_STYLE}">${esc(name)}</span>`;
}

function srcLabel(s: Substitution): string {
  const src = s.source === "pinned" ? "置顶评论" : s.source === "danmaku" ? "弹幕" : "评论区";
  return s.likes ? `${src}·${s.likes}赞` : src;
}

/** 建议行的元信息尾部：来源 + 溯源链接 + 原文引用 */
function substMeta(s: Substitution): string {
  const link = s.evidenceUrl ? ` <a href="${esc(s.evidenceUrl)}" target="_blank">溯源</a>` : "";
  return `（${srcLabel(s)}）${link}<span class="quote">“${esc(s.evidence.slice(0, 40))}”</span>`;
}

/** 一条独立成行的实战建议（替代者名着色） */
export function renderSubLine(s: Substitution, hasOp: HasOp): string {
  return `<div class="sub-line">${nameSpan(s.replacement, hasOp)}${substMeta(s)}</div>`;
}

export function renderSlot(slot: RecommendedSlot, hasOp: HasOp): string {
  const op = nameSpan(slot.original.operator, hasOp);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  const alts = slot.alternatives.length
    ? `<div class="alts"><span class="dim">其他实战建议：</span>${slot.alternatives
        .map((s) => renderSubLine(s, hasOp))
        .join("")}</div>`
    : "";

  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <b>${nameSpan(slot.finalOperator!, hasOp)}</b>${substMeta(slot.via)}` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      alts +
      `</div>`
    );
  }
  return (
    `<div class="slot unresolved">✗ ${op}${keyTag}${supTag} — 无解` +
    (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
    (slot.alternatives.length
      ? `<div class="alts"><span class="dim">实战建议：</span>${slot.alternatives
          .map((s) => renderSubLine(s, hasOp))
          .join("")}</div>`
      : "") +
    `</div>`
  );
}

export function renderResult(out: AnalysisOutput, hasOp: HasOp): string {
  const s = out.stats;
  const statsLine = s
    ? `抓取弹幕 ${s.danmakuTotal} 条 → 候选池：评论 ${s.commentCandidates} + 弹幕 ${s.danmakuCandidates}｜`
    : "";
  return (
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果（阵容来自画面识别）</div>` +
    `<div class="hint">实战替代建议：${out.substitutions.length} 条｜${statsLine}名字颜色：<span class="own">绿=你有</span>／<span class="miss">红=你没有</span></div>` +
    out.recommendations.map((s2) => renderSlot(s2, hasOp)).join("")
  );
}
