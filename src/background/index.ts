/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① 阵容提取（画面）→ ② 替代建议挖掘（弹幕/评论）→ ③ 匹配推荐。
 *
 * 两种 LLM 调用模式：
 * - API 模式：后台全自动；
 * - 网页版模式（半自动，免 Key）：
 *     注入第 1 段提示词（含截图）→ 用户在 chat.deepseek.com 发送 →
 *     用户点「注入第二段」→ 注入第 2 段（引用上下文中的阵容）→ 用户发送 →
 *     用户把最终回复粘贴回插件（含 roster + substitutions）→ 出结果。
 */

import {
  locateStage,
  buildTextContext,
  buildRosterPromptText,
  parseRosterReply,
  extractRosterFromImage,
} from "../shared/roster";
import { fetchComments, fetchDanmaku } from "../shared/bilibili";
import { mineSubstitutions, buildWebCombinedMessages, parseMiningReply } from "../shared/miner";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import { getLlmConfig, injectWebPrompt, parseJsonLoose } from "../shared/llm";
import type { AnalysisOutput, Box, Roster, Substitution, TaskState } from "../shared/types";

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

// ---------- 网页版半自动：等待用户动作（注入第二段 / 粘贴回复） ----------

let userResolver: ((text: string) => void) | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function waitForUser(): Promise<string> {
  keepaliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  return new Promise((resolve) => {
    userResolver = resolve;
  });
}

function resolveUser(text: string): boolean {
  if (!userResolver) return false;
  const r = userResolver;
  userResolver = null;
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

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "抓取弹幕/评论…" });
  const commentsPromise = fetchComments(meta.video.aid, 200).catch(() => []);
  const danmakuPromise = meta.cid ? fetchDanmaku(meta.cid).catch(() => []) : Promise.resolve([]);
  const comments = await commentsPromise;
  const textContext = buildTextContext(meta.video, comments);

  const cfg = await getLlmConfig().catch(() => null);
  let roster: Roster;
  let substitutions: Substitution[];

  if (cfg?.mode === "web") {
    // 单段合并：识别阵容 + 挖掘建议一次完成，只输出一个 JSON（一次发送、一次回贴）
    const danmaku = await danmakuPromise;
    const { messages: combined, candidates } = buildWebCombinedMessages(
      meta.stage,
      buildRosterPromptText(meta, textContext),
      comments,
      danmaku,
      imageDataUrls,
    );
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "正在打开 DeepSeek 网页版并注入提示词…" });
    await injectWebPrompt(combined);
    await setTask({
      status: "web_paste",
      startedAt,
      stage: meta.stage,
      progress: "提示词（含截图与弹幕/评论）已注入 DeepSeek 网页版——请在该页面按回车发送，然后把最终回复整段粘贴回插件",
    });
    const finalText = await waitForUser();

    const parsed = parseJsonLoose<{ roster?: unknown; substitutions?: unknown }>(finalText);
    if (!parsed.roster || typeof parsed.roster !== "object") {
      throw new Error("回复里缺少 roster 字段：请粘贴模型的完整回复（应同时包含 roster 与 substitutions）");
    }
    roster = parseRosterReply(JSON.stringify(parsed.roster), meta, opDB);
    const items = Array.isArray(parsed.substitutions) ? parsed.substitutions : [];
    substitutions = parseMiningReply(
      items,
      roster.slots.map((s) => s.operator),
      candidates,
      roster.stage,
      roster.videoId,
      opDB,
    );
  } else {
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 识别画面阵容…" });
    roster = await extractRosterFromImage(meta, imageDataUrls, opDB, textContext);
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 分析替代建议…" });
    const danmaku = await danmakuPromise;
    substitutions = await mineSubstitutions(roster, comments, danmaku, opDB);
  }

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
    sendResponse({ ok: resolveUser(String(msg.text ?? "")) });
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
