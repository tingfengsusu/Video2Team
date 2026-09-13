/**
 * Content Script：识别B站视频页 + 抓取播放器当前帧。
 * popup 在 tab.url 不可见（host 权限未授予）时，通过本脚本在页面内拿 location。
 * 抓帧：B站播放器为 MSE blob 流（同源），canvas 可绘制；受保护时降级为粘贴截图。
 */

function parseContext(): { bvid: string | null; page: number | null } {
  const bvid = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = new URLSearchParams(location.search).get("p");
  return { bvid, page: p ? parseInt(p, 10) : null };
}

function grabFrame(): { ok: boolean; dataUrl?: string; reason?: string } {
  const video = document.querySelector("video");
  if (!video || !video.videoWidth) {
    return { ok: false, reason: "页面未找到视频画面（请确认视频已开始播放）" };
  }
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { ok: false, reason: "画布创建失败" };
  ctx.drawImage(video, 0, 0);
  try {
    return { ok: true, dataUrl: canvas.toDataURL("image/jpeg", 0.92) };
  } catch {
    return { ok: false, reason: "画面受保护无法直接抓取，请暂停后用截图 + Ctrl+V 粘贴" };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PAGE_CONTEXT") {
    sendResponse(parseContext());
  }
  if (msg?.type === "GRAB_FRAME") {
    sendResponse(grabFrame());
  }
});

export {};
