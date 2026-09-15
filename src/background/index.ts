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
import { prepareMining, buildWebCombinedMessages, parseMiningReply, type Candidate } from "../shared/miner";
import { callLLM } from "../shared/llm";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import { getLlmConfig, injectWebPrompt, startWebWatch, stopWebWatch, parseJsonLoose } from "../shared/llm";
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

// ---------- 网页版半自动：等待自动读取结果 / 用户粘贴（两者竞速） ----------

let userResolver: ((text: string) => void) | null = null;
let webResultResolver: ((text: string) => void) | null = null;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function ensureKeepalive(): void {
  if (!keepaliveTimer) {
    keepaliveTimer = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  }
}

function stopKeepaliveIfIdle(): void {
  if (!userResolver && !webResultResolver && keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

function waitForUser(): Promise<string> {
  ensureKeepalive();
  return new Promise((resolve) => {
    userResolver = resolve;
  });
}

function resolveUser(text: string): boolean {
  if (!userResolver) return false;
  const r = userResolver;
  userResolver = null;
  stopKeepaliveIfIdle();
  r(text);
  return true;
}

function waitForWebResult(): Promise<string> {
  ensureKeepalive();
  return new Promise((resolve) => {
    webResultResolver = resolve;
  });
}

function resolveWebResult(text: string): boolean {
  if (!webResultResolver) return false;
  const r = webResultResolver;
  webResultResolver = null;
  stopKeepaliveIfIdle();
  r(text);
  return true;
}

/** 竞速结束后清掉未兑现的等待方 */
function clearPendingWaits(): void {
  userResolver = null;
  webResultResolver = null;
  stopKeepaliveIfIdle();
}

/** 读取用户高级设置（候选上限 / 自动读取开关） */
async function getAdvanced(): Promise<{
  caps: { comments?: number; danmaku?: number };
  autoRead: boolean;
}> {
  const { advanced } = (await chrome.storage.local.get("advanced")) as {
    advanced?: { commentCap?: number; danmakuCap?: number; webAutoRead?: boolean };
  };
  return {
    caps: { comments: advanced?.commentCap, danmaku: advanced?.danmakuCap },
    autoRead: advanced?.webAutoRead !== false, // 默认开启自动读取
  };
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
  const { caps, autoRead } = await getAdvanced();
  let roster: Roster;
  let substitutions: Substitution[];
  let danmakuAll: Array<{ time: number; text: string }> = [];
  let candidates: Candidate[] = [];

  if (cfg?.mode === "web") {
    // 单段合并：识别阵容 + 挖掘建议一次完成，只输出一个 JSON（一次发送）
    const danmaku = await danmakuPromise;
    danmakuAll = danmaku;
    const { messages: combined, candidates: mineCands } = buildWebCombinedMessages(
      meta.stage,
      buildRosterPromptText(meta, textContext),
      comments,
      danmaku,
      imageDataUrls,
      caps,
    );
    candidates = mineCands;
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "正在打开 DeepSeek 网页版并注入提示词…" });
    const tabId = await injectWebPrompt(combined);
    await setTask({
      status: "web_paste",
      startedAt,
      stage: meta.stage,
      progress: autoRead
        ? "提示词（含截图与弹幕/评论）已注入——请在网页版按回车发送，回复将自动读取（失败时可手动粘贴）"
        : "提示词（含截图与弹幕/评论）已注入 DeepSeek 网页版——请在该页面发送，然后把最终回复整段粘贴回插件",
    });
    let finalText: string;
    if (autoRead) {
      await startWebWatch(tabId);
      // 自动读取与手动粘贴竞速，先到者生效
      finalText = await Promise.race([waitForWebResult(), waitForUser()]);
      void stopWebWatch(tabId);
      clearPendingWaits();
    } else {
      finalText = await waitForUser();
      clearPendingWaits();
    }
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "已收到回复，匹配你的 box…" });

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
    danmakuAll = danmaku;
    const { messages: mineMsgs, candidates: mineCands } = prepareMining(
      roster.stage,
      roster.slots.map((sl) => sl.operator),
      comments,
      danmaku,
      caps,
    );
    candidates = mineCands;
    if (mineCands.length === 0) {
      substitutions = [];
    } else {
      const raw = await callLLM(mineMsgs);
      let items: unknown[] = [];
      try {
        const v = parseJsonLoose<unknown>(raw);
        items = Array.isArray(v) ? v : ((v as { substitutions?: unknown[] })?.substitutions ?? []);
      } catch {
        items = [];
      }
      substitutions = parseMiningReply(
        items,
        roster.slots.map((sl) => sl.operator),
        mineCands,
        roster.stage,
        roster.videoId,
        opDB,
      );
    }
  }

  const recommendations = recommend(roster, substitutions, box);
  const stats = {
    danmakuTotal: danmakuAll.length,
    commentCandidates: candidates.filter((c) => c.source !== "danmaku").length,
    danmakuCandidates: candidates.filter((c) => c.source === "danmaku").length,
  };
  return { roster, substitutions, recommendations, videoTitle: meta.video.title, stage: meta.stage, bvid, stats };
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
  if (msg?.type === "WEB_LLM_RESULT") {
    // 网页端内容脚本自动读取到的回复
    sendResponse({ ok: resolveWebResult(String(msg.text ?? "")) });
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
