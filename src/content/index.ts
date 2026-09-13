/**
 * Content Script：识别B站视频页（提取 BV 号 + 分P序号），响应 popup 的上下文查询。
 * popup 在 tab.url 不可见（host 权限未授予）时，通过本脚本在页面内拿 location。
 */

function parseContext(): { bvid: string | null; page: number | null } {
  const bvid = location.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/)?.[1] ?? null;
  const p = new URLSearchParams(location.search).get("p");
  return { bvid, page: p ? parseInt(p, 10) : null };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "GET_PAGE_CONTEXT") {
    sendResponse(parseContext());
  }
});

export {};
