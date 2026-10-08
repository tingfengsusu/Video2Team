/**
 * 结果渲染（纯字符串生成，popup 与 content 页内面板共用）。
 *
 * 着色约定（用户要求，2026-09-13）：**干员名字体颜色** = 是否在你 box：
 * 绿色(.own) = 你有，红色(.miss) = 你没有。背景不做红绿（避免混淆），
 * 状态仅用左侧色条区分（保留/替换/无解）。
 * 派遣占用（矢量突破类活动）：被派遣锁定的干员名后加 🔒 徽章（悬停显示锁在哪个关）。
 */

import type { AnalysisOutput, LockedOps, RecommendedSlot, Substitution } from "./types";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type HasOp = (name: string) => boolean;

/** 内联样式（优先级最高，不依赖 CSS 类是否加载/更新） */
const OWN_STYLE = "color:#1a7f37;font-weight:700";
const MISS_STYLE = "color:#c0392b;font-weight:700";

/** 干员名（按是否持有着色——内联样式，绿=你有 红=你没有；被派遣则加 🔒） */
function nameSpan(name: string, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  const owned = hasOp(name);
  const lockStage = lockedOps[name];
  const badge = lockStage
    ? `<span class="lockbadge" style="color:#b8860b" title="已派遣：${esc(lockStage)}">🔒</span>`
    : "";
  return `<span class="${owned ? "own" : "miss"}" style="${owned ? OWN_STYLE : MISS_STYLE}">${esc(name)}</span>${badge}`;
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

/** 一条独立成行的实战建议（替代者名着色 + 占用徽章） */
export function renderSubLine(s: Substitution, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  return `<div class="sub-line">${nameSpan(s.replacement, hasOp, lockedOps)}${substMeta(s)}</div>`;
}

export function renderSlot(slot: RecommendedSlot, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  const op = nameSpan(slot.original.operator, hasOp, lockedOps);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  const alts = slot.alternatives.length
    ? `<div class="alts"><span class="dim">其他实战建议：</span>${slot.alternatives
        .map((s) => renderSubLine(s, hasOp, lockedOps))
        .join("")}</div>`
    : "";

  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <b>${nameSpan(slot.finalOperator!, hasOp, lockedOps)}</b>${substMeta(slot.via)}` +
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
          .map((s) => renderSubLine(s, hasOp, lockedOps))
          .join("")}</div>`
      : "") +
    `</div>`
  );
}

export function renderResult(out: AnalysisOutput, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  const s = out.stats;
  const statsLine = s
    ? `抓取弹幕 ${s.danmakuTotal} 条 → 候选池：评论 ${s.commentCandidates} + 弹幕 ${s.danmakuCandidates}｜`
    : "";
  return (
    `<div class="video-title">${esc(out.videoTitle)}</div>` +
    `<div class="stage">${esc(out.stage)} 适配结果（阵容来自画面识别）</div>` +
    `<div class="hint">实战替代建议：${out.substitutions.length} 条｜${statsLine}名字颜色：<span class="own">绿=你有</span>／<span class="miss">红=你没有</span>${Object.keys(lockedOps).length ? "｜🔒=已派遣" : ""}</div>` +
    out.recommendations.map((s2) => renderSlot(s2, hasOp, lockedOps)).join("") +
    (s?.unknownNames && s.unknownNames.length
      ? `<div class="slot unresolved">⚠ 有 ${s.unknownNames.length} 个称呼未能识别：${s.unknownNames
          .map((n) => esc(n))
          .join("、")}<div class="note">已记入设置页「昵称纠错」——填写正确干员名并采纳后，下次分析即可识别</div></div>`
      : "")
  );
}

/** 占用清单区块（矢量突破类活动）：被派遣干员 chips，✕ 可移除 */
export function renderLockedSection(lockedOps: LockedOps): string {
  const entries = Object.entries(lockedOps);
  if (entries.length === 0) {
    return `<div class="hint" style="color:#999">清单为空。分析每个派遣关的攻略后，点结果下方「加入占用清单」逐个累加。</div>`;
  }
  return entries
    .map(
      ([name, stage]) =>
        `<span class="lockchip" style="display:inline-block;background:#fdf3d8;border:1px solid #e8d48a;border-radius:12px;padding:2px 8px;margin:2px;font-size:12px">` +
        `<b>${esc(name)}</b><span class="dim"> · ${esc(stage)}</span>` +
        `<span class="rmlock" data-name="${esc(name)}" title="移除" style="cursor:pointer;color:#c0392b;margin-left:4px">✕</span></span>`,
    )
    .join("");
}
