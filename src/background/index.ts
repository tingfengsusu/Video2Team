/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① roster.extractRosterFromImage（画面提取）→ ②a miner.mineSubstitutions → ③ recommender.recommend
 * 阵容必须来自用户提供的画面（截图/抓帧）；简介文本仅作辅助上下文。
 * 任务状态持久化到 storage.session：popup 关闭/重开后可恢复「分析中/结果/错误」。
 */

import { locateStage, buildTextContext, extractRosterFromImage } from "../shared/roster";
import { fetchComments, fetchDanmaku } from "../shared/bilibili";
import { mineSubstitutions } from "../shared/miner";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import type { AnalysisOutput, Box, TaskState } from "../shared/types";

const TASK_KEY = "task";

async function setTask(task: TaskState): Promise<void> {
  await chrome.storage.session.set({ [TASK_KEY]: task });
}

async function getBox(): Promise<Box> {
  const { box } = (await chrome.storage.local.get("box")) as { box?: Box };
  if (!box?.operators || Object.keys(box.operators).length === 0) {
    throw new Error("尚未导入干员 box，请到插件设置页导入一图流 Excel 练度表");
  }
  return box;
}

async function analyzeVideo(
  bvid: string,
  page: number | undefined,
  imageDataUrls: string[],
): Promise<AnalysisOutput> {
  const startedAt = Date.now();
  const box = await getBox();
  const opDB = await OperatorDB.load();
  const meta = await locateStage(bvid, page);
  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "抓取弹幕/评论…" });

  // 弹幕与评论并行抓取（弹幕在识图 LLM 运行期间继续拉）
  const commentsPromise = fetchComments(meta.video.aid, 200).catch(() => []);
  const danmakuPromise = meta.cid ? fetchDanmaku(meta.cid).catch(() => []) : Promise.resolve([]);

  const comments = await commentsPromise;
  const textContext = buildTextContext(meta.video, comments);

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 识别画面阵容…" });
  const roster = await extractRosterFromImage(meta, imageDataUrls, opDB, textContext);

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 分析替代建议…" });
  const danmaku = await danmakuPromise;
  const substitutions = await mineSubstitutions(roster, comments, danmaku, opDB);

  const recommendations = recommend(roster, substitutions, box);
  return { roster, substitutions, recommendations, videoTitle: meta.video.title, stage: meta.stage, bvid };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ANALYZE_VIDEO") {
    // 先落「running」状态，popup 关闭后重开也能看到进行中
    void setTask({ status: "running", startedAt: Date.now() });
    analyzeVideo(msg.bvid, msg.page, msg.imageDataUrls)
      .then(async (result) => {
        await setTask({ status: "done", startedAt: Date.now(), result });
        sendResponse({ ok: true, result });
      })
      .catch(async (err: Error) => {
        await setTask({ status: "error", startedAt: Date.now(), error: err.message });
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async sendResponse
  }
  if (msg?.type === "GET_TASK") {
    chrome.storage.session
      .get(TASK_KEY)
      .then((v) => sendResponse({ task: (v as Record<string, TaskState>)[TASK_KEY] ?? null }));
    return true;
  }
  if (msg?.type === "OPEN_OPTIONS") {
    // content script 无法直接调 openOptionsPage，经后台转发
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }
});
