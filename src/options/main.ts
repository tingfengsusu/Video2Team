/**
 * 设置页逻辑：
 * - AI 接口配置（OpenAI 兼容）：预设选择 / 自定义地址 / 保存（含可选 host 权限申请）/ 测试连接；
 * - box 导入：一图流 Excel（纯本地解析）。
 */

import { parseYituliuExcel } from "../shared/box";
import { PRESETS, getLlmConfig, type LlmConfig } from "../shared/llm";
import {
  getPending,
  approvePending,
  dismissPending,
  userAliasCount,
  type PendingEntry,
} from "../shared/aliases";
import { clearResultCache, RESULT_CACHE_KEY, type ResultCache } from "../shared/resultCache";
import { normalizePage } from "../shared/resultCache";
import { clearLevelDbCache } from "../shared/maa";
import { clearBiliMineCache } from "../shared/dispatchGuides";
import { fetchBiliAccount } from "../shared/bilibili";
import {
  FEEDBACK_TYPES,
  buildDiagnostics,
  buildFeedbackAction,
  copyToClipboard,
  type FeedbackSignature,
} from "../shared/feedback";
import { FEEDBACK_MID, REPO_ISSUES_URL } from "../shared/constants";
import type { TaskState } from "../shared/types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const providerSel = $("provider") as HTMLSelectElement;
const baseUrlIn = $("baseUrl") as HTMLInputElement;
const modelIn = $("model") as HTMLInputElement;
const keyIn = $("apiKey") as HTMLInputElement;
const timeoutIn = $("timeout") as HTMLInputElement;

function currentMode(): "api" | "web" {
  const checked = document.querySelector<HTMLInputElement>('input[name="llmMode"]:checked');
  return checked?.value === "web" ? "web" : "api";
}

function applyModeUi(): void {
  const web = currentMode() === "web";
  ($("apiFields") as HTMLElement).style.display = web ? "none" : "";
  ($("webNote") as HTMLElement).style.display = web ? "" : "none";
}

function llmStatus(msg: string, ok: boolean): void {
  const el = $("llmStatus");
  el.textContent = msg;
  el.className = ok ? "note ok" : "note bad";
}

function currentLlm(): LlmConfig | null {
  const baseUrl = baseUrlIn.value.trim().replace(/\/+$/, "");
  const model = modelIn.value.trim();
  if (!baseUrl || !model) {
    llmStatus("请填写 API 地址与模型名", false);
    return null;
  }
  try {
    new URL(baseUrl);
  } catch {
    llmStatus("API 地址格式不正确", false);
    return null;
  }
  return {
    mode: "api",
    provider: providerSel.value,
    baseUrl,
    model,
    apiKey: keyIn.value.trim(),
    timeoutMs: Math.max(30, parseInt(timeoutIn.value || "240", 10)) * 1000,
  };
}

/** 非预设地址需要申请 host 权限（manifest optional_host_permissions） */
async function ensurePermission(baseUrl: string): Promise<boolean> {
  try {
    const origin = new URL(baseUrl).origin + "/*";
    if (await chrome.permissions.contains({ origins: [origin] })) return true;
    return await chrome.permissions.request({ origins: [origin] });
  } catch {
    return false;
  }
}

async function saveLlm(): Promise<void> {
  if (currentMode() === "web") {
    const cfg: LlmConfig = {
      mode: "web",
      provider: "web",
      baseUrl: "",
      model: "",
      apiKey: "",
      timeoutMs: 240_000,
    };
    await chrome.storage.local.set({ llm: cfg });
    llmStatus("已保存（网页版模式）✓", true);
    return;
  }
  const cfg = currentLlm();
  if (!cfg) return;
  const granted = await ensurePermission(cfg.baseUrl);
  if (!granted) {
    llmStatus("未授予对该地址的访问权限，无法调用（请在弹窗中允许）", false);
    return;
  }
  await chrome.storage.local.set({ llm: cfg });
  llmStatus("已保存 ✓", true);
  setTimeout(() => (($("llmStatus") as HTMLElement).textContent = ""), 2000);
}

async function testLlm(): Promise<void> {
  if (currentMode() === "web") {
    llmStatus("检查 DeepSeek 网页版…", true);
    try {
      const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
      let tabId = tabs.find((t) => t.id != null)?.id;
      if (tabId == null) {
        const created = await chrome.tabs.create({ url: "https://chat.deepseek.com/", active: true });
        tabId = created.id ?? undefined;
      }
      if (tabId == null) {
        llmStatus("无法打开 DeepSeek 网页版", false);
        return;
      }
      for (let i = 0; i < 15; i++) {
        try {
          const r = await chrome.tabs.sendMessage(tabId, { type: "WEB_LLM_PING" });
          if (r?.ready) {
            llmStatus("✓ 网页版已就绪（已登录，可正常调用）", true);
            return;
          }
        } catch {
          /* 注入延迟，重试 */
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      llmStatus("页面已打开：请确认已登录 chat.deepseek.com 后重试", false);
    } catch (err) {
      llmStatus(`检查失败：${(err as Error).message}`, false);
    }
    return;
  }
  const cfg = currentLlm();
  if (!cfg) return;
  const granted = await ensurePermission(cfg.baseUrl);
  if (!granted) {
    llmStatus("未授予对该地址的访问权限", false);
    return;
  }
  llmStatus("测试中…", true);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  try {
    const resp = await fetch(cfg.baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "请只回复两个大写字母：OK" }],
        max_tokens: 8,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      llmStatus(`连接失败 ${resp.status}：${text.slice(0, 120)}`, false);
      return;
    }
    const j = await resp.json();
    const reply = j?.choices?.[0]?.message?.content ?? "(无内容)";
    llmStatus(`✓ 连接成功，模型回复：${String(reply).slice(0, 30)}`, true);
  } catch (err) {
    llmStatus(`连接失败：${(err as Error).message}`, false);
  }
}

function applyPreset(id: string): void {
  const p = PRESETS[id];
  if (!p) return;
  if (id !== "custom") {
    baseUrlIn.value = p.baseUrl;
    modelIn.value = p.model;
  }
  $("presetNote").textContent = p.note ?? "";
}

async function initLlmSection(): Promise<void> {
  for (const [id, p] of Object.entries(PRESETS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    providerSel.appendChild(opt);
  }
  providerSel.addEventListener("change", () => applyPreset(providerSel.value));
  document.querySelectorAll<HTMLInputElement>('input[name="llmMode"]').forEach((r) =>
    r.addEventListener("change", applyModeUi),
  );

  let cfg: LlmConfig | null = null;
  try {
    cfg = await getLlmConfig();
  } catch {
    /* 未配置：留空表单（默认 API + DeepSeek 预设） */
  }
  const mode = cfg?.mode ?? "web"; // 推荐：网页版（免 Key）
  const modeRadio = document.querySelector<HTMLInputElement>(`input[name="llmMode"][value="${mode}"]`);
  if (modeRadio) modeRadio.checked = true;
  providerSel.value = cfg && cfg.provider in PRESETS ? cfg.provider : cfg && mode === "api" ? "custom" : "deepseek";
  baseUrlIn.value = cfg?.baseUrl || PRESETS.deepseek!.baseUrl;
  modelIn.value = cfg?.model || PRESETS.deepseek!.model;
  keyIn.value = cfg?.apiKey ?? "";
  timeoutIn.value = String(Math.round((cfg?.timeoutMs ?? 240_000) / 1000));
  $("presetNote").textContent = PRESETS[providerSel.value]?.note ?? "";
  applyModeUi();

  $("saveLlm").addEventListener("click", () => void saveLlm());
  $("testLlm").addEventListener("click", () => void testLlm());
}

async function initBoxSection(): Promise<void> {
  const { box } = (await chrome.storage.local.get("box")) as {
    box?: { operators?: Record<string, unknown>; source?: string };
  };
  renderBoxStatus(box);

  $("excelFile").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    $("boxError").textContent = "";
    $("boxStatus").textContent = "解析中…";
    try {
      const parsed = await parseYituliuExcel(file);
      await chrome.storage.local.set({ box: parsed });
      renderBoxStatus(parsed);
    } catch (err) {
      $("boxStatus").textContent = "";
      $("boxError").textContent = `导入失败：${(err as Error).message}`;
    }
  });
}

function renderBoxStatus(box: { operators?: Record<string, unknown>; source?: string } | undefined): void {
  const count = box?.operators ? Object.keys(box.operators).length : 0;
  $("boxStatus").textContent =
    count > 0
      ? `已导入 ${count} 名干员（来源：${box?.source === "excel" ? "一图流 Excel" : "森空岛"}）`
      : "尚未导入";
}

/** 高级：候选上限 + 网页版自动读取开关 + 派遣关 B站挖掘范围/页数 */
async function initAdvancedSection(): Promise<void> {
  const { advanced } = (await chrome.storage.local.get("advanced")) as {
    advanced?: {
      commentCap?: number;
      danmakuCap?: number;
      webAutoRead?: boolean;
      biliScope?: string;
      biliPages?: number;
      biliMaxAgeDays?: number;
      hideUnavailableSchemes?: boolean;
      schemeRows?: number;
    };
  };
  const { resultCache } = (await chrome.storage.local.get(RESULT_CACHE_KEY)) as {
    resultCache?: ResultCache;
  };
  ($("capComments") as HTMLInputElement).value = String(advanced?.commentCap ?? 60);
  ($("capDanmaku") as HTMLInputElement).value = String(advanced?.danmakuCap ?? 60);
  ($("webAutoRead") as HTMLInputElement).checked = advanced?.webAutoRead !== false; // 默认开
  ($("biliScope") as HTMLSelectElement).value =
    advanced?.biliScope === "thin" || advanced?.biliScope === "off" ? advanced.biliScope : "all";
  ($("biliPages") as HTMLInputElement).value = String(advanced?.biliPages ?? 2);
  ($("biliMaxAgeDays") as HTMLSelectElement).value = String(advanced?.biliMaxAgeDays ?? 180);
  // 默认开：候选池只列可抄方案（缺干员/已被占用不显示）——列表更长更可用
  ($("hideUnavailable") as HTMLInputElement).checked = advanced?.hideUnavailableSchemes !== false;
  ($("schemeRows") as HTMLInputElement).value = String(advanced?.schemeRows ?? 12);
  const cacheCount = Object.keys(resultCache ?? {}).length;
  $("cacheStatus").textContent =
    cacheCount > 0 ? `当前缓存 ${cacheCount} 条（最多 30 条 / 7 天）` : "当前无分析缓存";

  $("saveAdvanced").addEventListener("click", async () => {
    const clamp = (id: string, def: number) => {
      const v = parseInt(($(id) as HTMLInputElement).value || String(def), 10);
      return Number.isFinite(v) ? Math.min(300, Math.max(10, v)) : def;
    };
    const pages = parseInt(($("biliPages") as HTMLInputElement).value || "2", 10);
    const ageDays = parseInt(($("biliMaxAgeDays") as HTMLSelectElement).value || "180", 10);
    const rows = parseInt(($("schemeRows") as HTMLInputElement).value || "12", 10);
    await chrome.storage.local.set({
      advanced: {
        commentCap: clamp("capComments", 60),
        danmakuCap: clamp("capDanmaku", 60),
        webAutoRead: ($("webAutoRead") as HTMLInputElement).checked,
        biliScope: ($("biliScope") as HTMLSelectElement).value,
        biliPages: Number.isFinite(pages) ? Math.min(5, Math.max(1, pages)) : 2,
        biliMaxAgeDays: Number.isFinite(ageDays) && ageDays > 0 ? ageDays : 0,
        hideUnavailableSchemes: ($("hideUnavailable") as HTMLInputElement).checked,
        schemeRows: Number.isFinite(rows) ? Math.min(30, Math.max(2, rows)) : 12,
      },
    });
    const el = $("advStatus");
    el.textContent = "已保存 ✓";
    setTimeout(() => (el.textContent = ""), 2000);
  });

  $("clearCache").addEventListener("click", async () => {
    if (!window.confirm("确定清空全部分析结果缓存吗？")) return;
    await clearResultCache();
    await clearBiliMineCache().catch(() => {});
    await clearLevelDbCache().catch(() => {});
    $("cacheStatus").textContent = "已清空分析缓存";
  });
}

/** 昵称纠错：待确认列表渲染与采纳/忽略交互 */
async function renderPending(): Promise<void> {
  const list = $("pendingList");
  const foot = $("pendingFoot") as HTMLElement;
  const entries: PendingEntry[] = await getPending();

  if (entries.length === 0) {
    list.innerHTML = `<div class="note">（暂无待确认条目）</div>`;
    foot.style.display = "none";
  } else {
    foot.style.display = "block";
    list.innerHTML = entries
      .map(
        (e) => `
      <div class="pendingRow" data-name="${escapeAttr(e.name)}">
        <span class="pendingName">${escapeAttr(e.name)}</span>
        <span class="note">×${e.count}</span>
        ${e.sample ? `<div class="note">样例："${escapeAttr(e.sample)}"</div>` : ""}
        <input list="operatorNames" placeholder="正确的干员全名" />
        <button class="approve">采纳</button>
        <button class="ghost dismiss">忽略</button>
      </div>`,
      )
      .join("");
  }

  const userCount = await userAliasCount();
  $("userAliasInfo").textContent =
    userCount > 0 ? `本地对照已积累 ${userCount} 条（优先级最高，覆盖在线与内置数据）` : "本地对照暂无条目";
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function initAliasSection(): Promise<void> {
  // 干员全名候选列表（用于输入补全）
  try {
    const resp = await fetch(chrome.runtime.getURL("data/operators.json"));
    const data = (await resp.json()) as Record<string, { name?: string }>;
    const names = Object.values(data)
      .map((v) => v.name)
      .filter((n): n is string => !!n)
      .sort((a, b) => a.localeCompare(b, "zh"));
    $("operatorNames").innerHTML = names.map((n) => `<option value="${escapeAttr(n)}"></option>`).join("");
  } catch {
    /* 补全失败不阻塞 */
  }

  $("pendingList").addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest(".pendingRow") as HTMLElement | null;
    if (!row) return;
    const name = row.getAttribute("data-name") ?? "";
    if (!name) return;
    if (target.classList.contains("approve")) {
      const input = row.querySelector("input") as HTMLInputElement;
      const full = input.value.trim();
      if (!full) {
        input.focus();
        $("pendingStatus").textContent = "请先填写正确的干员全名";
        return;
      }
      await approvePending(name, full);
      $("pendingStatus").textContent = "";
      await renderPending();
    } else if (target.classList.contains("dismiss")) {
      await dismissPending(name);
      await renderPending();
    }
  });

  async function buildSubmission(): Promise<string> {
    const stored = (await chrome.storage.local.get("aliases_user")) as {
      aliases_user?: Record<string, string>;
    };
    return Object.entries(stored.aliases_user ?? {})
      .map(([k, v]) => `${k} → ${v}`)
      .join("\n");
  }

  async function buildPendingExport(): Promise<string> {
    const entries = await getPending();
    return JSON.stringify(
      {
        source: "Video2Team",
        kind: "corrections_pending",
        exportedAt: new Date().toISOString(),
        corrections_pending: Object.fromEntries(entries.map((entry) => [entry.name, entry])),
      },
      null,
      2,
    );
  }

  $("submitCommunity").addEventListener("click", async () => {
    const body = await buildSubmission();
    if (!body) {
      $("submitStatus").textContent = "本地对照为空，无需提交";
      return;
    }
    const title = "[昵称补充] 本地积累的昵称→干员对照";
    const content =
      "以下昵称→干员全名对照来自插件本地积累，均经人工确认，申请并入社区对照表：\n\n```\n" +
      body +
      "\n```\n";
    const url =
      "https://github.com/tingfengsusu/Video2Team/issues/new?title=" +
      encodeURIComponent(title) +
      "&body=" +
      encodeURIComponent(content);
    window.open(url, "_blank");
    $("submitStatus").textContent = "已打开 GitHub 提交页（需登录 GitHub；无账号请用「复制内容」）";
  });

  $("copyCommunity").addEventListener("click", async () => {
    const body = await buildSubmission();
    if (!body) {
      $("submitStatus").textContent = "本地对照为空，无需提交";
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      $("submitStatus").textContent = "已复制，可粘贴到 Issue / 帖子 / 群里";
    } catch {
      $("submitStatus").textContent = "复制失败，请手动选中文本";
    }
  });

  $("exportPending").addEventListener("click", async () => {
    const pending = await getPending();
    if (pending.length === 0) {
      $("submitStatus").textContent = "错题本为空，无需导出";
      return;
    }
    try {
      await navigator.clipboard.writeText(await buildPendingExport());
      $("submitStatus").textContent = `已导出 ${pending.length} 条待确认称呼，可粘贴到别名编辑器`;
    } catch {
      $("submitStatus").textContent = "复制失败；请打开在线别名编辑器后手动录入";
    }
  });

  $("dismissAll").addEventListener("click", async () => {
    const entries = await getPending();
    await Promise.all(entries.map((e) => dismissPending(e.name)));
    await renderPending();
  });

  await renderPending();
}

/** §5：当前页面上下文（优先最近任务，其次任一打开的B站视频页） */
async function feedbackPageContext(): Promise<{ bvid: string; page: number } | null> {
  try {
    const { task } = (await chrome.storage.session.get("task")) as { task?: TaskState };
    if (task?.bvid) return { bvid: task.bvid, page: normalizePage(task.page) };
  } catch {
    /* session 不可用则继续 */
  }
  try {
    const tabs = await chrome.tabs.query({ url: "https://www.bilibili.com/video/*" });
    for (const t of tabs) {
      const m = (t.url ?? "").match(/\/video\/(BV[0-9A-Za-z]+)/);
      if (!m) continue;
      const p = new URL(t.url!).searchParams.get("p");
      return { bvid: m[1]!, page: normalizePage(p ? parseInt(p, 10) : undefined) };
    }
  } catch {
    /* 忽略 */
  }
  return null;
}

/** §5 反馈：复制全文 + 打开作者B站私信（未配置 UID 时降级为仅复制） */
async function initFeedbackSection(): Promise<void> {
  let type: string = FEEDBACK_TYPES[0];
  const typesEl = $("fbTypes");
  typesEl.innerHTML = FEEDBACK_TYPES.map(
    (t) => `<span class="fbType${t === type ? " on" : ""}" data-type="${escapeAttr(t)}">${escapeAttr(t)}</span>`,
  ).join("");
  typesEl.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest(".fbType") as HTMLElement | null;
    if (!el) return;
    type = el.getAttribute("data-type") ?? type;
    for (const s of typesEl.querySelectorAll(".fbType")) s.classList.toggle("on", s === el);
  });

  let signature: FeedbackSignature | null = null;
  const account = await fetchBiliAccount();
  if (account.isLogin && account.uname) {
    signature = { uname: account.uname, uid: account.uid };
    ($("fbSignRow") as HTMLElement).style.display = "";
    $("fbSignInfo").textContent = `已读取B站昵称：${account.uname}（UID ${account.uid}）——不回传任何登录凭证`;
  } else {
    $("fbSignInfo").textContent = "未检测到B站登录（或本机还没打开过B站页面）：将不带署名发送";
  }

  const { llm, box } = (await chrome.storage.local.get(["llm", "box"])) as {
    llm?: { mode?: string };
    box?: { operators?: Record<string, unknown> };
  };
  let lastError = "";
  try {
    const s = (await chrome.storage.session.get("task")) as { task?: TaskState };
    lastError = s.task?.error ?? "";
  } catch {
    /* 忽略 */
  }
  ($("fbDiag") as HTMLTextAreaElement).value = buildDiagnostics({
    version: chrome.runtime.getManifest().version,
    mode: llm?.mode === "web" ? "网页版" : llm?.mode === "api" ? "API" : "未配置",
    boxCount: box?.operators ? Object.keys(box.operators).length : 0,
    page: await feedbackPageContext(),
    lastError,
  });

  const status = $("fbStatus");
  status.textContent = FEEDBACK_MID.trim()
    ? `作者私信直达已配置（B站 UID ${FEEDBACK_MID}）—— 主按钮会复制反馈全文并打开私信页`
    : "作者私信直达未配置（FEEDBACK_MID 为空）—— 主按钮当前为「仅复制」模式";

  const collect = () => ({
    type,
    description: ($("fbDesc") as HTMLTextAreaElement).value,
    diagnostics: ($("fbDiag") as HTMLTextAreaElement).value,
    signature: ($("fbSign") as HTMLInputElement).checked ? signature : null,
  });

  $("fbMain").addEventListener("click", async () => {
    const action = buildFeedbackAction(collect());
    const ok = await copyToClipboard(action.text);
    status.textContent = ok ? action.hint : "复制失败，请手动选中反馈文本";
    if (action.mode === "copy+dm" && action.dmUrl) {
      await chrome.tabs.create({ url: action.dmUrl }).catch(() => {});
    }
  });

  $("fbCopy").addEventListener("click", async () => {
    const ok = await copyToClipboard(buildFeedbackAction(collect()).text);
    status.textContent = ok ? "已复制反馈全文到剪贴板" : "复制失败，请手动选中反馈文本";
  });

  $("fbIssue").addEventListener("click", () => {
    const text = buildFeedbackAction(collect()).text;
    const url =
      `${REPO_ISSUES_URL}?title=${encodeURIComponent(`[反馈] ${type}`)}&body=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
    status.textContent = "已打开 GitHub Issue 预填页（备用出口）";
  });
}

/** 面板底部「反馈」入口 → 滚动到设置页反馈区 */
async function handleOptionsFocus(): Promise<void> {
  try {
    const { optionsFocus } = (await chrome.storage.session.get("optionsFocus")) as {
      optionsFocus?: string;
    };
    if (optionsFocus !== "feedback") return;
    await chrome.storage.session.remove("optionsFocus");
    document.getElementById("feedback")?.scrollIntoView({ behavior: "smooth", block: "start" });
    ($("fbDesc") as HTMLTextAreaElement).focus();
  } catch {
    /* 忽略 */
  }
}

async function init(): Promise<void> {
  await initLlmSection();
  await initBoxSection();
  await initAdvancedSection();
  await initFeedbackSection();
  await initAliasSection();
  await handleOptionsFocus();
}

init();
