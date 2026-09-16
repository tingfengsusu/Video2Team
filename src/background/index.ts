/**
 * Service Worker：消息路由 + 管道编排（设计见 docs/design.md §4）。
 * 管道：① 阵容识别（画面）+ ② 替代建议挖掘（弹幕/评论）→ ③ 匹配推荐。
 *
 * 2026-09-16 统一：两种调用模式都用**单次合并提示词**（{"roster","substitutions"} 一次返回），
 * 消除 API 模式两次串行调用的延迟（网页端 4-5s vs API 1min 的差距主要来自调用次数）。
 *
 * - API 模式：后台一次 callLLM 全自动；
 * - 网页版模式（半自动，免 Key）：注入提示词（含截图）→ 用户在 chat.deepseek.com 发送 →
 *   自动读取回复（DOM 观察，与手动粘贴竞速）→ 成功后自动关闭插件自己开的 DeepSeek 标签页。
 */

import { locateStage, buildTextContext, buildRosterPromptText, parseRosterReply } from "../shared/roster";
import { fetchComments, fetchDanmaku } from "../shared/bilibili";
import { buildWebCombinedMessages, parseMiningReply, type Candidate } from "../shared/miner";
import { recommend } from "../shared/recommender";
import { OperatorDB } from "../shared/operatorDB";
import { loadAliases } from "../shared/aliases";
import {
  callLLM,
  getLlmConfig,
  injectWebPrompt,
  startWebWatch,
  stopWebWatch,
  parseJsonLoose,
} from "../shared/llm";
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

// ---------- 网页版：等待自动读取结果 / 用户粘贴（竞速） ----------

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

function clearPendingWaits(): void {
  userResolver = null;
  webResultResolver = null;
  stopKeepaliveIfIdle();
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
  await loadAliases(); // 别名三层：内置 + 在线 + 本地积累
  const meta = await locateStage(bvid, page);
  const { caps, autoRead } = await getAdvanced();

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "抓取弹幕/评论…" });
  const commentsPromise = fetchComments(meta.video.aid, 200).catch(() => []);
  const danmakuPromise = meta.cid ? fetchDanmaku(meta.cid).catch(() => []) : Promise.resolve([]);
  const comments = await commentsPromise;
  const textContext = buildTextContext(meta.video, comments);

  // 单次合并提示词：识别阵容 + 挖掘建议，一次返回 {"roster","substitutions"}
  const danmaku = await danmakuPromise;
  const { messages: combined, candidates } = buildWebCombinedMessages(
    meta.stage,
    buildRosterPromptText(meta, textContext),
    comments,
    danmaku,
    imageDataUrls,
    caps,
  );

  const cfg = await getLlmConfig().catch(() => null);
  let finalText: string;

  if (cfg?.mode === "web") {
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "正在打开 DeepSeek 网页版并注入提示词…" });
    const { tabId, created } = await injectWebPrompt(combined);
    await setTask({
      status: "web_paste",
      startedAt,
      stage: meta.stage,
      progress: autoRead
        ? "提示词（含截图与弹幕/评论）已注入——请在网页版按回车发送，回复将自动读取（失败时可手动粘贴）"
        : "提示词（含截图与弹幕/评论）已注入 DeepSeek 网页版——请在该页面发送，然后把最终回复整段粘贴回插件",
    });

    let wonBy: "auto" | "manual" | null = null;
    if (autoRead) {
      await startWebWatch(tabId);
      // 45 秒仍无结果 → 明示提示（自动读取可能未检测到回复），引导手动粘贴
      const hint = setTimeout(() => {
        void setTask({
          status: "web_paste",
          startedAt,
          stage: meta.stage,
          progress: "自动读取尚未检测到回复——请确认已在网页版按回车发送；也可直接把回复粘贴到下方框",
        });
      }, 45_000);
      try {
        finalText = await Promise.race([
          waitForWebResult().then((t) => {
            wonBy = "auto";
            return t;
          }),
          waitForUser().then((t) => {
            wonBy = "manual";
            return t;
          }),
        ]);
      } finally {
        clearTimeout(hint);
        void stopWebWatch(tabId);
        clearPendingWaits();
      }
      // 自动读取成功 → 关闭插件自己打开的 DeepSeek 标签页（不动用户原有的）
      if (wonBy === "auto" && created) {
        void chrome.tabs.remove(tabId).catch(() => {});
      }
    } else {
      finalText = await waitForUser();
      clearPendingWaits();
    }
  } else {
    await setTask({ status: "running", startedAt, stage: meta.stage, progress: "AI 分析中（识别阵容 + 挖掘建议，单次调用）…" });
    finalText = await callLLM(combined);
  }

  await setTask({ status: "running", startedAt, stage: meta.stage, progress: "解析回复并匹配你的 box…" });
  const parsed = parseJsonLoose<{ roster?: unknown; substitutions?: unknown }>(finalText);
  if (!parsed.roster || typeof parsed.roster !== "object") {
    throw new Error("回复里缺少 roster 字段：请确认模型输出的是完整 JSON（含 roster 与 substitutions）");
  }
  const unknownNames: string[] = [];
  const onUnknown = (n: string): void => {
    const t = n.trim();
    if (t && !unknownNames.includes(t)) unknownNames.push(t);
  };
  const roster: Roster = parseRosterReply(JSON.stringify(parsed.roster), meta, opDB, onUnknown);
  const items = Array.isArray(parsed.substitutions) ? parsed.substitutions : [];
  const substitutions: Substitution[] = parseMiningReply(
    items,
    roster.slots.map((s) => s.operator),
    candidates,
    roster.stage,
    roster.videoId,
    opDB,
    onUnknown,
  );

  const recommendations = recommend(roster, substitutions, box);
  const stats = {
    danmakuTotal: danmaku.length,
    commentCandidates: candidates.filter((c) => c.source !== "danmaku").length,
    danmakuCandidates: candidates.filter((c) => c.source === "danmaku").length,
    unknownNames,
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
