/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① roster.extractRoster → ②a miner.mineSubstitutions → ③ recommender.recommend
 */

import { locateStage, extractRoster } from "../shared/roster";
import { fetchComments, fetchDanmaku } from "../shared/bilibili";
import { mineSubstitutions } from "../shared/miner";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import type { AnalysisOutput, Box } from "../shared/types";

async function getBox(): Promise<Box> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  if (!box?.operators || Object.keys(box.operators).length === 0) {
    throw new Error("尚未导入干员 box，请到插件设置页导入一图流 Excel 练度表");
  }
  return box;
}

async function analyzeVideo(bvid: string, page?: number): Promise<AnalysisOutput> {
  const box = await getBox();
  const opDB = await OperatorDB.load();
  const meta = await locateStage(bvid, page);
  const roster = await extractRoster(meta, opDB);
  const comments = await fetchComments(meta.video.aid, 200);
  const danmaku = meta.cid ? await fetchDanmaku(meta.cid).catch(() => []) : [];
  const substitutions = await mineSubstitutions(roster, comments, danmaku, opDB);
  const recommendations = recommend(roster, substitutions, box);
  return { roster, substitutions, recommendations, videoTitle: meta.video.title, stage: meta.stage, bvid };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ANALYZE_VIDEO") {
    analyzeVideo(msg.bvid, msg.page)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true; // async sendResponse
  }
});
