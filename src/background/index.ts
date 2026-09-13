/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① roster.extractRoster → ②a miner.mineSubstitutions → ③ recommender.recommend
 */

import type { StageResult } from "../shared/types";

async function analyzeVideo(bvid: string): Promise<StageResult> {
  // TODO(v0): 编排 ①②a③，box 从 chrome.storage 读取，未导入 box 时提示先去 options 导入
  throw new Error("not implemented: v0 管道编排");
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "ANALYZE_VIDEO") {
    analyzeVideo(msg.bvid)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // async sendResponse
  }
});
