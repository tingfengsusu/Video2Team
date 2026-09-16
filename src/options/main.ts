/**
 * 设置页逻辑：
 * - AI 接口配置（OpenAI 兼容）：预设选择 / 自定义地址 / 保存（含可选 host 权限申请）/ 测试连接；
 * - box 导入：一图流 Excel（纯本地解析）。
 */

import { parseYituliuExcel } from "../shared/box";
import { PRESETS, getLlmConfig, type LlmConfig } from "../shared/llm";

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

/** 高级：候选上限 + 网页版自动读取开关 */
async function initAdvancedSection(): Promise<void> {
  const { advanced } = (await chrome.storage.local.get("advanced")) as {
    advanced?: { commentCap?: number; danmakuCap?: number; webAutoRead?: boolean };
  };
  ($("capComments") as HTMLInputElement).value = String(advanced?.commentCap ?? 60);
  ($("capDanmaku") as HTMLInputElement).value = String(advanced?.danmakuCap ?? 60);
  ($("webAutoRead") as HTMLInputElement).checked = advanced?.webAutoRead !== false; // 默认开

  $("saveAdvanced").addEventListener("click", async () => {
    const clamp = (id: string, def: number) => {
      const v = parseInt(($(id) as HTMLInputElement).value || String(def), 10);
      return Number.isFinite(v) ? Math.min(300, Math.max(10, v)) : def;
    };
    await chrome.storage.local.set({
      advanced: {
        commentCap: clamp("capComments", 60),
        danmakuCap: clamp("capDanmaku", 60),
        webAutoRead: ($("webAutoRead") as HTMLInputElement).checked,
      },
    });
    const el = $("advStatus");
    el.textContent = "已保存 ✓";
    setTimeout(() => (el.textContent = ""), 2000);
  });
}

async function init(): Promise<void> {
  await initLlmSection();
  await initBoxSection();
  await initAdvancedSection();
}

init();
