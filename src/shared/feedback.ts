/**
 * §5 反馈机制：复制反馈全文 + 跳转作者B站私信页。
 *
 * 纯本地拼文本，不发起任何上传；只有用户点击主按钮时才打开新标签页。
 * 未配置作者 UID（constants.FEEDBACK_MID 为空）时主按钮降级为「仅复制」。
 */

import { FEEDBACK_MID, feedbackDmUrl } from "./constants";

export const FEEDBACK_TYPES = ["问题/Bug", "功能建议", "数据源反馈", "其他"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

export interface FeedbackSignature {
  uname: string; // B站昵称
  uid: number | string; // B站 UID
}

export interface FeedbackInput {
  type: string;
  description: string;
  diagnostics: string; // 自动诊断信息（预览可编辑）
  signature?: FeedbackSignature | null; // null / 未登录 → 不显示署名行
  mid?: string; // 覆盖作者 UID（默认 constants.FEEDBACK_MID；便于自测）
}

export interface FeedbackAction {
  /** copy+dm = 复制并打开作者私信；copy-only = 作者 UID 未配置，降级为仅复制 */
  mode: "copy+dm" | "copy-only";
  text: string;
  dmUrl: string;
  hint: string;
}

/** 拼出完整反馈文本（剪贴板 / 手动粘贴到私信都用这一份） */
export function buildFeedbackText(input: FeedbackInput): string {
  const lines: string[] = [];
  lines.push(`【${String(input.type ?? "").trim() || "反馈"}】`);
  lines.push(String(input.description ?? "").trim() || "（未填写描述）");
  lines.push("");
  lines.push("—— 自动诊断信息 ——");
  for (const line of String(input.diagnostics ?? "").split("\n")) {
    const t = line.trim();
    if (t) lines.push(t.startsWith("·") ? t : `· ${t}`);
  }
  const sig = input.signature;
  if (sig?.uname) {
    const uid = String(sig.uid ?? "").trim();
    lines.push(`· 署名：${sig.uname}${uid ? `（UID ${uid}）` : ""}`);
  }
  lines.push("");
  lines.push("来自 Video2Team 插件反馈");
  return lines.join("\n");
}

/** 主按钮行为：配置了作者 UID → 复制 + 打开私信；未配置 → 仅复制 */
export function buildFeedbackAction(input: FeedbackInput): FeedbackAction {
  const text = buildFeedbackText(input);
  const mid = String(input.mid ?? FEEDBACK_MID).trim();
  const dmUrl = feedbackDmUrl(mid);
  if (!dmUrl) {
    return {
      mode: "copy-only",
      text,
      dmUrl: "",
      hint: "作者私信直达未配置（FEEDBACK_MID 为空）：已复制反馈全文，请手动发给作者",
    };
  }
  return {
    mode: "copy+dm",
    text,
    dmUrl,
    hint: "已复制反馈全文，正在打开作者私信页——粘贴发送即可",
  };
}

/** 构造自动诊断信息（不含任何凭证 / 练度内容） */
export function buildDiagnostics(parts: {
  version: string;
  mode: string;
  boxCount: number;
  page?: { bvid: string; page: number } | null;
  lastError?: string;
}): string {
  const lines = [
    `插件版本 ${parts.version || "unknown"}`,
    `AI 模式 ${parts.mode || "未配置"}`,
    `box 人数 ${parts.boxCount} 人`,
  ];
  if (parts.page?.bvid) {
    lines.push(`当前页面 ${parts.page.bvid}${parts.page.page > 0 ? ` ｜ 分P ${parts.page.page}` : ""}`);
  }
  if (parts.lastError) lines.push(`最近一次错误：${parts.lastError}`);
  return lines.join("\n");
}

/** 复制到剪贴板（扩展页优先 navigator.clipboard，失败回退 execCommand） */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续回退 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
