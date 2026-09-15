/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① roster.extractRosterFromImage（画面提取）→ ②a miner.mineSubstitutions → ③ recommender.recommend
 * 阵容必须来自用户提供的画面（截图/抓帧）；简介文本仅作辅助上下文。
 *
 * 两种调用模式：
 * - API 模式：LLM 调用在后台完成，任务状态经 storage.session 供 popup/面板恢复；
 * - 网页版模式（半自动）：把提示词注入 chat.deepseek.com，任务进入 awaiting_paste，
 *   用户发送并回贴回复（PASTE_REPLY）后继续下一步。
 */

import { locateStage, buildTextContext, extractRosterFromImage } from "../shared/roster";
import { fetchComments, fetchDanmaku } from "../shared/bilibili";
import { mineSubstitutions } from "../shared/miner";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import { getLlmConfig, injectWebPrompt } from "../shared/llm";
import type { AnalysisOutput, Box, TaskState } from "../shared/types";
import type { AskFn } from "../shared/llm";

const TASK_KEY = "task";

// session storage 默认只对可信上下文（扩展页面/后台）开放，
// content script（视频页面板）读截图/任务状态会报
// "Access to storage is not allowed from this context" —— 显式放开。
void chrome.storage.session
  .setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" })
  .catch(() => {});

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

// ---------- 网页版半自动：注入提示词 → 等待用户回贴回复 ----------

let pasteResolver: ((text: string) => void) | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function waitForPaste(): Promise<string> {
  keepaliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return new Promise((resolve) => {
    pasteResolver = resolve;
  });
}

function resolvePaste(text: string): boolean {
  if (!pasteResolver) return false;
  const r = pasteResolver;
  pasteResolver = null;
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
  r(text);
  return true;
}

// ---------- 管道 ----------

async function analyzeVideo(
  bvid: string,
  page: number | undefined,
  imageDataUrls: string[],
): Promise<AnalysisOutput> {
  const startedAt = Date.now();
  const box = await getBox();
  const opDB = await OperatorDB.load();
  const meta = await locateStage(bvid, page);

  // 网页版模式：构造 ask —— 注入提示词到 DeepSeek 网页版，等用户回贴回复
  const cfg = await getLlmConfig().catch(() => null);
  let ask: AskFn | undefined;
  if (cfg?.mode === "web") {
    const labels = ["识别画面阵容", "挖掘替代建议"];
    let step = 0;
    ask = async (messages) => {
      step++;
      const label = labels[step - 1] ?? `步骤 ${step}`;
      await setTask({
        status: "awaiting_paste",
        startedAt,
        stage: meta.stage,
        progress: `第 ${step} 步「${label}」：提示词${step === 1 ? "与截图" : ""}已送入 DeepSeek 网页版——请在该页面按回车发送，然后把整段回复粘贴回插件`,
      });
      await injectWebPrompt(messages);
      return waitForPaste();
    };
  }

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "抓取弹幕/评论…" });
  const commentsPromise = fetchComments(meta.video.aid, 200).catch(() => []);
  const danmakuPromise = meta.cid ? fetchDanmaku(meta.cid).catch(() => []) : Promise.resolve([]);
  const comments = await commentsPromise;
  const textContext = buildTextContext(meta.video, comments);

  if (!ask) {
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 识别画面阵容…" });
  }
  const roster = await extractRosterFromImage(meta, imageDataUrls, opDB, textContext, ask);

  if (!ask) {
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 分析替代建议…" });
  }
  const danmaku = await danmakuPromise;
  const substitutions = await mineSubstitutions(roster, comments, danmaku, opDB, ask);

  const recommendations = recommend(roster, substitutions, box);
  return { roster, substitutions, recommendations, videoTitle: meta.video.title, stage: meta.stage, bvid };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ANALYZE_VIDEO") {
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
  if (msg?.type === "PASTE_REPLY") {
    sendResponse({ ok: resolvePaste(String(msg.text ?? "")) });
    return true;
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
