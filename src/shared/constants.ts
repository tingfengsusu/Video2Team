/**
 * 全局常量（少量、易改）。
 */

/**
 * 作者B站 UID（§5 反馈直达私信）。
 * TODO: 填入你的B站UID（纯数字）—— 打开自己的B站个人空间，URL `space.bilibili.com/12345678`
 * 里的数字即 UID。留空时「复制并打开私信」主按钮自动降级为「仅复制」。
 */
export const FEEDBACK_MID = "";

/** GitHub Issue 预填口径（备用反馈出口） */
export const REPO_ISSUES_URL = "https://github.com/tingfengsusu/Video2Team/issues/new";

/** B站私信页（作者 UID 拼接） */
export function feedbackDmUrl(mid: string): string {
  const id = String(mid ?? "").trim();
  return id ? `https://message.bilibili.com/#/whisper/mid${id}` : "";
}
