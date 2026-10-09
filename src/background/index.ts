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
import { chainMapFor, chainPrereqs } from "../shared/constants";
import {
  callLLM,
  getLlmConfig,
  injectWebPrompt,
  startWebWatch,
  stopWebWatch,
  parseJsonLoose,
} from "../shared/llm";
import { normalizePage, putCachedResult } from "../shared/resultCache";
import {
  buildDispatchPool,
  eventPrefixFromStageId,
  getLevelDb,
  listDispatchStages,
  queryCopilots,
  resolveEventPrefix,
} from "../shared/maa";
import { mineStageWithLlm, type BiliScheme } from "../shared/biliDig";
import { mergePools } from "../shared/dispatchPool";
import { biliMiningNote, buildDispatchGuides, type DispatchGuidesStats } from "../shared/dispatchGuides";
import { formatStageResolution, inferEventPrefix, resolveStageForAnalysis } from "../shared/stageResolver";
import type {
  AnalysisOutput,
  Box,
  Roster,
  StageVisionHints,
  Substitution,
  TaskState,
} from "../shared/types";

const TASK_KEY = "task";

// 大窗口关闭后清掉记录，下次点「⤢ 大窗口」才能重新开
chrome.windows.onRemoved.addListener((windowId) => {
  void chrome.storage.session
    .get(["bigWindowId", "bigWindowSourceTabId"])
    .then((v) => {
      const { bigWindowId, bigWindowSourceTabId } = v as {
        bigWindowId?: number;
        bigWindowSourceTabId?: number;
      };
      if (bigWindowId !== windowId) return undefined;
      return chrome.storage.session
        .remove(["bigWindowId", "bigWindowSourceTabId"])
        .catch(() => {}) as Promise<undefined>;
    })
    .catch(() => {});
});

// 第十五轮 q1：大窗口的"宿主"标签页（B站页面）关掉时，大窗口也一起关掉
// （用户实测：视频页关了，悬浮的大窗口还留在屏幕上）
chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const { bigWindowSourceTabId, bigWindowId } = (await chrome.storage.session.get([
      "bigWindowSourceTabId",
      "bigWindowId",
    ])) as { bigWindowSourceTabId?: number; bigWindowId?: number };
    if (typeof bigWindowSourceTabId !== "number" || bigWindowSourceTabId !== tabId) return;
    if (typeof bigWindowId === "number") {
      await chrome.windows.remove(bigWindowId).catch(() => {});
    }
    await chrome.storage.session.remove(["bigWindowId", "bigWindowSourceTabId"]).catch(() => {});
  })();
});

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

/** 占用清单（派遣锁定）：被派遣干员在推图关不可用（矢量突破类活动） */
async function getLockedOps(): Promise<Record<string, string>> {
  const { lockedOps } = (await chrome.storage.local.get("lockedOps")) as {
    lockedOps?: Record<string, string>;
  };
  return lockedOps ?? {};
}

/** 读取用户高级设置（候选上限 / 自动读取开关 / 派遣关 B站挖掘范围·页数·时间窗） */
async function getAdvanced(): Promise<{
  caps: { comments?: number; danmaku?: number };
  autoRead: boolean;
  biliScope: "all" | "thin" | "off";
  biliPages: number;
  biliMaxAgeDays: number;
}> {
  const { advanced } = (await chrome.storage.local.get("advanced")) as {
    advanced?: {
      commentCap?: number;
      danmakuCap?: number;
      webAutoRead?: boolean;
      biliScope?: "all" | "thin" | "off";
      biliPages?: number;
      biliMaxAgeDays?: number;
    };
  };
  const scope = advanced?.biliScope;
  const pages = Number(advanced?.biliPages);
  const maxAge = Number(advanced?.biliMaxAgeDays);
  return {
    caps: { comments: advanced?.commentCap, danmaku: advanced?.danmakuCap },
    autoRead: advanced?.webAutoRead !== false, // 默认开启自动读取
    // 默认全关挖掘（B站攻略基数大于 MAA，召回优先）；页数默认 2 页
    biliScope: scope === "thin" || scope === "off" ? scope : "all",
    biliPages: Number.isFinite(pages) ? Math.min(5, Math.max(1, Math.trunc(pages))) : 2,
    // 默认只看半年内（挡掉上一期活动的旧攻略）；0 = 不限
    biliMaxAgeDays: Number.isFinite(maxAge) ? Math.max(0, Math.trunc(maxAge)) : 180,
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
  const taskBase = { bvid, page: normalizePage(page) };
  const box = await getBox();
  const opDB = await OperatorDB.load();
  await loadAliases(); // 别名三层：内置 + 在线 + 本地积累
  // 关卡名与干员名撞车的护栏（第十二轮实测：「0-9」的关名是「临光」，而「临光」也是干员名、
  // 还是「耀骑士临光」的子串——简介/评论里一提干员，整关就被解析成「0-9（临光）」）；
  // 只在"简介/评论"这类弱文本里启用，标题里出现仍然算数
  const opNames = opDB.names();
  const nameMatchOpts = {
    isOperatorLike: (name: string) =>
      opDB.exists(name) || opNames.some((n) => n !== name && n.includes(name)),
  };
  let meta = await locateStage(bvid, page);
  const sourceStage = meta.stage;
  let stageResolution = (
    await resolveStageForAnalysis(sourceStage, meta.video.title, meta.video.desc, undefined, nameMatchOpts)
  ).resolution;
  meta = { ...meta, stage: formatStageResolution(stageResolution, sourceStage) };
  const { caps, autoRead, biliScope, biliPages, biliMaxAgeDays } = await getAdvanced();

  await setTask({ ...taskBase, status: "running", startedAt, stage: meta.stage, progress: "抓取弹幕/评论…" });
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
    await setTask({
      ...taskBase,
      status: "running",
      startedAt,
      stage: meta.stage,
      progress: "正在打开 DeepSeek 网页版并注入提示词…",
    });
    const { tabId, created } = await injectWebPrompt(combined);
    await setTask({
      ...taskBase,
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
          ...taskBase,
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
    await setTask({
      ...taskBase,
      status: "running",
      startedAt,
      stage: meta.stage,
      progress: "AI 分析中（识别阵容 + 挖掘建议，单次调用）…",
    });
    finalText = await callLLM(combined);
  }

  await setTask({
    ...taskBase,
    status: "running",
    startedAt,
    stage: meta.stage,
    progress: "解析回复并匹配你的 box…",
  });
  const parsed = parseJsonLoose<{
    stageResolution?: StageVisionHints;
    roster?: unknown;
    substitutions?: unknown;
  }>(finalText);
  if (!parsed.roster || typeof parsed.roster !== "object") {
    throw new Error("回复里缺少 roster 字段：请确认模型输出的是完整 JSON（含 roster 与 substitutions）");
  }
  const visionResolution = await resolveStageForAnalysis(
    sourceStage,
    meta.video.title,
    meta.video.desc,
    parsed.stageResolution,
    nameMatchOpts,
  );
  stageResolution = visionResolution.resolution;
  meta = { ...meta, stage: visionResolution.displayStage };
  const dispatchCandidates = [...visionResolution.dispatchCandidates];
  // 第十一轮 q4：关卡链——某些派遣关必须先打它的前置关（实测 10→9、12→11），打前置关同样要占干员，
  // 所以程序侧自动把前置关也纳入候选池（纯程序，不需要模型判断）。
  {
    const codes = () => dispatchCandidates.map((c) => c.displayCode);
    const extra = chainPrereqs(codes());
    if (extra.length) {
      const levels = await getLevelDb().catch(() => []);
      for (const code of extra) {
        const level = levels.find((l) => l.displayCode.toUpperCase() === code);
        dispatchCandidates.push({
          gridPosition: 0,
          displayCode: code,
          stageId: level?.stageId ?? "",
          stageName: level?.name ?? "",
        });
      }
    }
  }
  const chainOf: Record<string, string> =
    chainMapFor(dispatchCandidates.map((c) => c.displayCode)) ?? {}; // 依赖关 → 前置关（结果页说明用）
  // 识别依据：把「模型看到的是第几格 / 格内读到什么」摊开给用户看（截图顺序不固定，故不写"P1"）；
  // 识别不准时可用结果区的「不是这关」一键排除（render.ts 的 skip-stage / restore-stage）
  const dispatchGuideEvidence: Record<string, string> = {};
  const chainDependents: Record<string, string> = {}; // 前置关 → 依赖它的关（反查，供说明用）
  for (const [dep, prev] of Object.entries(chainOf)) chainDependents[prev] = dep;
  for (const c of dispatchCandidates) {
    const parts: string[] = [];
    const code = c.displayCode.toUpperCase();
    if (chainDependents[code]) {
      parts.push(`关卡链前置：${chainDependents[code]} 需要先打本关（已自动加入候选池）`);
    } else if (c.gridPosition) {
      // 直接写出映射（序号 → 关卡码）：用户实测确认「序号」才是可靠依据，文字只是参考
      parts.push(`特别战线网格第 ${c.gridPosition} 格 → ${c.displayCode}`);
    } else {
      parts.push("来自视频标题/分P 的显示码");
    }
    if (c.gridName) parts.push(`格内文字「${c.gridName}」`);
    if (c.needsVerification) parts.push("序号越界或与文字不一致，需核实");
    dispatchGuideEvidence[code] = parts.join("，");
  }
  // 与下面的解析/推荐并行跑（MAA + B站查询较慢，不阻塞结果）
  let dispatchGuidesPromise: Promise<{
    pools: NonNullable<AnalysisOutput["dispatchGuides"]>;
    stats: DispatchGuidesStats | null;
  }> = Promise.resolve({ pools: [], stats: null });
  if (dispatchCandidates.length > 0) {
    await setTask({
      ...taskBase,
      status: "running",
      startedAt,
      stage: meta.stage,
      progress: `已识别 P1 的 ${dispatchCandidates.length} 个派遣关，正在查询攻略…`,
    });
    dispatchGuidesPromise = buildDispatchGuides(dispatchCandidates, opDB, {
      perStageLimit: 8, // MAA 每关多留几条（同一次前缀查询里本来就有，只是不再过早截断）
      maxBiliStages: 8,
      thinThreshold: 2,
      biliScope, // 默认全部候选关（高级设置可改「仅薄关 / 关闭」）
      biliPages, // 每关搜索页数（默认 2）
      biliMaxAgeDays, // 只要最近 N 天（默认 180）：挡掉上一期活动的旧攻略
      maxPartsVideos: 3,
      maxDescVideos: 0, // 搜索结果自带简介，不再额外拉简介请求
    }).catch(() => ({ pools: [], stats: null }));
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

  const recommendations = recommend(roster, substitutions, box, await getLockedOps());
  const stats = {
    danmakuTotal: danmaku.length,
    commentCandidates: candidates.filter((c) => c.source !== "danmaku").length,
    danmakuCandidates: candidates.filter((c) => c.source === "danmaku").length,
    unknownNames,
  };
  const { pools: dispatchGuides, stats: guidesStats } = await dispatchGuidesPromise;
  // 本活动全部派遣关：结果区「＋ 补一个关…」用它做下拉选项（识别错了可手动补关）
  let dispatchStageOptions: { displayCode: string; stageName: string }[] | undefined;
  const anyStageId = dispatchGuides[0]?.stageId ?? dispatchCandidates[0]?.stageId;
  if (anyStageId) {
    const prefix = eventPrefixFromStageId(anyStageId);
    dispatchStageOptions = (prefix ? await listDispatchStages(prefix).catch(() => []) : []).map(
      (l) => ({ displayCode: l.displayCode, stageName: l.name }),
    );
  } else {
    // 第十四轮 q2：一个派遣关都没识别出来（模型只写了"像补给网格、但没给格位"）时，
    // 只要这条视频像是在讲特别战线，就把该活动的补给关清单也带上——结果区据此显示
    // 「选择补给关…」，让用户自己点，而不是只剩一句文字说明。
    const hintText = [
      visionResolution.dispatchGridNote ?? "",
      meta.stage,
      meta.video.title,
      meta.video.desc,
    ]
      .filter(Boolean)
      .join("\n");
    if (/特别战线|派遣|补给|VEC[\s_-]*SP/i.test(hintText)) {
      const levels = await getLevelDb().catch(() => []);
      const prefix = inferEventPrefix(hintText, levels);
      const stages = prefix ? await listDispatchStages(prefix).catch(() => []) : [];
      if (stages.length) {
        dispatchStageOptions = stages.map((l) => ({ displayCode: l.displayCode, stageName: l.name }));
      }
    }
  }
  if (dispatchStageOptions?.length === 0) dispatchStageOptions = undefined;
  const dispatchGuideNote = [
    visionResolution.dispatchGridNote,
    dispatchCandidates.length > 0 &&
    dispatchGuides.length > 0 &&
    dispatchGuides.every((pool) => pool.schemes.length === 0)
      ? "已识别 P1 派遣关，但 MAA / B站暂未查到公开攻略"
      : "",
    guidesStats ? biliMiningNote(guidesStats) : "",
  ]
    .filter(Boolean)
    .join("；") || undefined;
  return {
    roster,
    substitutions,
    recommendations,
    videoTitle: meta.video.title,
    stage: meta.stage,
    bvid,
    stageCode: stageResolution.displayCode,
    stageName: stageResolution.stageName,
    stageResolution,
    dispatchGuides,
    dispatchGuideNote,
    dispatchGuideEvidence: Object.keys(dispatchGuideEvidence).length
      ? dispatchGuideEvidence
      : undefined,
    dispatchStageOptions,
    dispatchStageChain: Object.keys(chainOf).length ? chainOf : undefined,
    stats,
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ANALYZE_VIDEO") {
    const bvid = String(msg.bvid ?? "");
    const requestedPage = msg.page == null || msg.page === "" ? undefined : Number(msg.page);
    const page = normalizePage(requestedPage);
    void setTask({ status: "running", startedAt: Date.now(), bvid, page });
    analyzeVideo(bvid, requestedPage, msg.imageDataUrls)
      .then(async (result) => {
        await putCachedResult(result, page);
        await setTask({ status: "done", startedAt: Date.now(), bvid, page, result });
        sendResponse({ ok: true, result });
      })
      .catch(async (err: Error) => {
        await setTask({ status: "error", startedAt: Date.now(), bvid, page, error: err.message });
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
  if (msg?.type === "OPEN_FEEDBACK") {
    // 面板底部「反馈」入口：打开设置页并滚动到反馈区
    void chrome.storage.session
      .set({ optionsFocus: "feedback" })
      .catch(() => {})
      .finally(() => chrome.runtime.openOptionsPage());
    sendResponse({ ok: true });
    return true;
  }
  // 「⤢ 大窗口查看结果」：把当前结果存 session 后开一个独立扩展窗口（~900px，一次性看全）
  if (msg?.type === "OPEN_BIG_RESULT") {
    void (async () => {
      const result = msg.result as AnalysisOutput | undefined;
      if (!result) {
        sendResponse({ ok: false, error: "没有可显示的结果" });
        return;
      }
      await chrome.storage.session.set({ bigResult: { result, ts: Date.now() } });
      const url = chrome.runtime.getURL("result.html");
      // 复用已开的大窗口：用窗口 id 记录（chrome.tabs.query({url}) 需要 tabs 权限，没申请会抛错 →
      // 之前每次点击都新开一个窗口）。这里只依赖 windows.get/update，无需额外权限。
      const { bigWindowId } = (await chrome.storage.session.get("bigWindowId")) as {
        bigWindowId?: number;
      };
      if (typeof bigWindowId === "number") {
        const alive = await chrome.windows.get(bigWindowId).catch(() => null);
        if (alive) {
          await chrome.windows.update(bigWindowId, { focused: true, drawAttention: true }).catch(() => {});
          // 记住"宿主"标签页：它被关掉时大窗口也跟着关（第十五轮 q1）
          if (sender?.tab?.id != null) {
            await chrome.storage.session.set({ bigWindowSourceTabId: sender.tab.id }).catch(() => {});
          }
          sendResponse({ ok: true, reused: true });
          return;
        }
      }
      const created = await chrome.windows.create({
        url,
        type: "popup",
        width: 940,
        height: Math.min(1060, Math.max(720, Math.round((msg.height as number) || 980))),
      });
      if (created?.id != null) {
        await chrome.storage.session
          .set({ bigWindowId: created.id, bigWindowSourceTabId: sender?.tab?.id ?? undefined })
          .catch(() => {});
      }
      sendResponse({ ok: true });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  // 结果区「＋ 补一个关…」/ 网格选关：按显示码现查该关候选池（MAA + B站）；
  // 带关卡链的关（10→9、12→11）会把它的前置关一并查回来（第十一轮 q4）
  if (msg?.type === "DISPATCH_QUERY_STAGE") {
    void (async () => {
      const requested = (Array.isArray(msg.displayCodes) ? msg.displayCodes : [msg.displayCode])
        .map((c: unknown) => String(c ?? "").trim().toUpperCase())
        .filter((c: string) => /^VEC-SP\d{1,2}$/.test(c));
      const displayCode = requested[0] ?? "";
      const stageName = msg.stageName ? String(msg.stageName) : undefined;
      if (!requested.length) {
        sendResponse({ ok: false, error: "只支持 VEC-SPxx 形式的派遣关" });
        return;
      }
      const levels = await getLevelDb().catch(() => []);
      const codes = [...requested, ...chainPrereqs(requested)].filter(
        (c, i, arr) => arr.indexOf(c) === i,
      );
      const candidates = codes.map((code) => {
        const level = levels.find((l) => l.displayCode.toUpperCase() === code);
        return {
          gridPosition: 0,
          displayCode: code,
          stageId: level?.stageId ?? "",
          stageName: level?.name ?? (code === displayCode ? stageName ?? "" : ""),
        };
      });
      const opDB = await OperatorDB.load();
      await loadAliases();
      // 与自动分析走**同一套设置**（第十三轮 q1：写死的 biliPages/scope 会让"手动补的关"和
      // "自动识别到的关"结果不一样）；单关/少关请求时把 B站 挖掘的关数上限放开到请求数量
      const { biliScope: manualScope, biliPages: manualPages, biliMaxAgeDays: manualMaxAge } =
        await getAdvanced();
      const res = await buildDispatchGuides(candidates, opDB, {
        perStageLimit: 8,
        maxBiliStages: candidates.length,
        thinThreshold: 2,
        biliScope: manualScope,
        biliPages: manualPages,
        biliMaxAgeDays: manualMaxAge,
        maxPartsVideos: 3,
        maxDescVideos: 0,
      });
      sendResponse({ ok: true, pools: res.pools, pool: res.pools[0] ?? null, stats: res.stats });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  // ---------- §2 MAA 作业站（prts.maa.plus）数据源 ----------
  if (msg?.type === "MAA_RESOLVE_EVENT") {
    void (async () => {
      const prefix = await resolveEventPrefix(String(msg.displayCode ?? ""), {
        eventName: msg.eventName ? String(msg.eventName) : undefined,
      });
      const stages = prefix ? await listDispatchStages(prefix) : [];
      sendResponse({ ok: true, prefix, stages });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "MAA_QUERY") {
    void (async () => {
      const res = await queryCopilots(String(msg.levelKeyword ?? ""), {
        page: msg.page,
        limit: msg.limit,
        orderBy: msg.orderBy,
        desc: msg.desc,
      });
      sendResponse({ ok: true, ...res });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg?.type === "MAA_DISPATCH_POOL") {
    void (async () => {
      const pools = await buildDispatchPool(String(msg.prefix ?? ""), {
        perStageLimit: msg.perStageLimit,
        maxPages: msg.maxPages,
      });
      sendResponse({ ok: true, pools });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  // ---------- §3 B站三级挖掘（补充数据源：实战视频与新打法） ----------
  if (msg?.type === "BILI_MINE_STAGE") {
    void (async () => {
      const opDB = await OperatorDB.load();
      await loadAliases(); // 标题纠错依赖合并后的别名表
      const res = await mineStageWithLlm(String(msg.displayCode ?? ""), opDB, {
        pages: msg.pages,
        maxPartsVideos: msg.maxPartsVideos,
        maxDescVideos: msg.maxDescVideos,
        // useLlm=false 时显式传 null → 只用干员字典兜底（不给 LLM 花钱）
        ask: msg.useLlm === false ? null : undefined,
      });
      sendResponse({ ok: true, ...res });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  // ---------- §3 候选池合并：MAA（结构化）+ B站（实战视频） ----------
  if (msg?.type === "DISPATCH_MINE_MERGE") {
    void (async () => {
      const prefix = String(msg.prefix ?? "").trim();
      const maaPools = await buildDispatchPool(prefix, {
        perStageLimit: msg.perStageLimit,
        maxPages: msg.maxPages,
      });
      const biliByStage = new Map<string, BiliScheme[]>();
      const thinThreshold = Math.max(1, Number(msg.thinThreshold) || 3);
      const maxStages = Math.max(0, Number(msg.maxStages) || 3);
      if (msg.mineBili !== false && maaPools.length && maxStages > 0) {
        const opDB = await OperatorDB.load();
        await loadAliases();
        // 只对「结构化方案较薄」的关卡做 B站挖掘，控制请求量
        const targets = maaPools.filter((p) => p.schemes.length < thinThreshold).slice(0, maxStages);
        for (const pool of targets) {
          try {
            const res = await mineStageWithLlm(pool.displayCode, opDB, {
              pages: 2,
              maxPartsVideos: 3,
              maxDescVideos: 5,
            });
            if (!res.failed && res.schemes.length) biliByStage.set(pool.displayCode, res.schemes);
          } catch {
            /* 单关 B站挖掘失败静默跳过，不影响 MAA 池 */
          }
        }
      }
      sendResponse({ ok: true, pools: mergePools(maaPools, biliByStage) });
    })().catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});
