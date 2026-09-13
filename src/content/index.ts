/**
 * Content Script：识别B站视频页（提取 BV 号），注入「分析阵容」入口。
 * 点击后向 background 发 ANALYZE_VIDEO 消息，结果面板 v0 可先跳转 popup 展示。
 */

const BV_PATTERN = /\/video\/(BV[0-9A-Za-z]+)/;

function extractBvid(): string | null {
  return window.location.pathname.match(BV_PATTERN)?.[1] ?? null;
}

// TODO(v0): 注入分析按钮到视频操作区，点击后 chrome.runtime.sendMessage({type: "ANALYZE_VIDEO", bvid})
console.log("[Video2Team] content script loaded, bvid =", extractBvid());

export {};
