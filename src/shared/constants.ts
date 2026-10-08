/**
 * 全局常量（少量、易改）。
 */

/**
 * 作者B站 UID（§5 反馈直达私信）。
 * 已填：1819482012（作者空间 https://space.bilibili.com/1819482012）。
 * 主按钮「复制并打开我的B站私信」会打开 https://message.bilibili.com/#/whisper/mid1819482012 。
 * 留空时该按钮自动降级为「仅复制」。
 */
export const FEEDBACK_MID = "1819482012";

/** GitHub Issue 预填口径（备用反馈出口） */
export const REPO_ISSUES_URL = "https://github.com/tingfengsusu/Video2Team/issues/new";

/** B站私信页（作者 UID 拼接） */
export function feedbackDmUrl(mid: string): string {
  const id = String(mid ?? "").trim();
  return id ? `https://message.bilibili.com/#/whisper/mid${id}` : "";
}
