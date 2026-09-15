/**
 * LLM 调用（OpenAI 兼容协议）——支持接入任意兼容服务：
 * DeepSeek / 智谱 GLM / Kimi / 通义 / 豆包 / 硅基流动 / OpenRouter / 本地 Ollama、One-API 网关…
 *
 * 配置存 chrome.storage.local.llm = { provider, baseUrl, model, apiKey, timeoutMs }；
 * 兼容旧版仅 apiKey 的存储（按 DeepSeek 默认迁移）。
 * 自定义端点首次保存时经 chrome.permissions.request 申请 host 权限（manifest optional_host_permissions）。
 */

export interface LlmConfig {
  mode: "api" | "web"; // api = OpenAI 兼容接口；web = chat.deepseek.com 网页版（免 Key，实验性）
  provider: string; // 预设 id（deepseek/zhipu/moonshot/.../custom）
  baseUrl: string; // 如 https://api.deepseek.com/v1（不含 /chat/completions）
  model: string;
  apiKey: string; // 本地服务（Ollama 等）可留空
  timeoutMs: number;
}

export interface LlmPreset {
  label: string;
  baseUrl: string;
  model: string;
  note?: string;
}

export const PRESETS: Record<string, LlmPreset> = {
  deepseek: {
    label: "DeepSeek（默认）",
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-v4-flash",
  },
  siliconflow: {
    label: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen2.5-VL-72B-Instruct",
  },
  zhipu: {
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4v-plus",
  },
  moonshot: {
    label: "Kimi (Moonshot)",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "moonshot-v1-8k-vision-preview",
  },
  dashscope: {
    label: "通义千问 (DashScope 兼容模式)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-vl-max",
  },
  doubao: {
    label: "豆包 (火山方舟)",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-1.5-vision-pro",
  },
  openai: {
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "google/gemini-2.0-flash-001",
  },
  ollama: {
    label: "本地 Ollama / 兼容网关",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5vl:7b",
    note: "本地服务无需 API Key；One-API/New-API 网关也填在这里",
  },
  custom: {
    label: "自定义（OpenAI 兼容）",
    baseUrl: "",
    model: "",
    note: "任何 OpenAI 兼容服务：填 API 地址（到 /v1 为止）与模型名即可",
  },
};

const DEFAULT_TIMEOUT = 240_000;

export async function getLlmConfig(): Promise<LlmConfig> {
  const stored = (await chrome.storage.local.get(["llm", "apiKey"])) as {
    llm?: Partial<LlmConfig>;
    apiKey?: string;
  };
  if (stored.llm?.mode === "web") {
    return { timeoutMs: DEFAULT_TIMEOUT, mode: "web", provider: "web", baseUrl: "", model: "", apiKey: "", ...stored.llm } as LlmConfig;
  }
  if (stored.llm?.baseUrl && stored.llm.model) {
    return { timeoutMs: DEFAULT_TIMEOUT, mode: "api", provider: "custom", apiKey: "", ...stored.llm } as LlmConfig;
  }
  // 兼容旧版：只有 apiKey → 按 DeepSeek 默认配置
  if (typeof stored.apiKey === "string" && stored.apiKey) {
    return {
      mode: "api",
      provider: "deepseek",
      baseUrl: PRESETS.deepseek!.baseUrl,
      model: PRESETS.deepseek!.model,
      apiKey: stored.apiKey,
      timeoutMs: DEFAULT_TIMEOUT,
    };
  }
  throw new Error("未配置 AI 接口，请到插件设置页选择调用方式并填写配置");
}

export type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

export async function callLLM(
  messages: ChatMessage[],
  options?: { timeoutMs?: number },
): Promise<string> {
  const cfg = await getLlmConfig();
  if (cfg.mode === "web") return callLLMWeb(messages);
  return callLLMApi(cfg, messages, options);
}

async function callLLMApi(
  cfg: LlmConfig,
  messages: ChatMessage[],
  options?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? cfg.timeoutMs ?? DEFAULT_TIMEOUT;
  const url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ model: cfg.model, messages, stream: false }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`AI 接口 ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("AI 返回格式异常（非 OpenAI 兼容响应？）");
    return content;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(
        `AI 接口请求超时（${Math.round(timeoutMs / 1000)} 秒），请重试或到设置页调整超时时间`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** 从 LLM 回复中解析 JSON（容忍 ```json fence 与前后杂文本） */
export function parseJsonLoose<T>(raw: string): T {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const text = (fence ? fence[1] : raw).trim();
  const start = text.search(/[[{]/);
  const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"));
  if (start === -1 || end === -1) throw new Error(`LLM 回复中未找到 JSON：${raw.slice(0, 120)}`);
  return JSON.parse(text.slice(start, end + 1)) as T;
}

// ---------- 网页版模式（chat.deepseek.com，实验性） ----------

const DEEPSEEK_WEB = "https://chat.deepseek.com/";

/** 把消息数组压成网页版单条输入：文本合并，图片单独提取 */
function flattenForWeb(messages: ChatMessage[]): { text: string; images: string[] } {
  const parts: string[] = [];
  const images: string[] = [];
  for (const m of messages) {
    if (typeof m.content === "string") {
      parts.push(m.content);
    } else {
      for (const c of m.content) {
        if (c.type === "text") parts.push(c.text);
        else if (c.type === "image_url") images.push(c.image_url.url);
      }
    }
  }
  return { text: parts.join("\n\n"), images };
}

async function pingWebTab(tabId: number): Promise<boolean> {
  try {
    const r = await chrome.tabs.sendMessage(tabId, { type: "WEB_LLM_PING" });
    return !!r?.ok;
  } catch {
    return false; // content script 未就绪（新标签页注入延迟）
  }
}

/** 找到或打开 chat.deepseek.com 标签页，并等待内容脚本就绪 */
async function ensureWebTab(): Promise<number> {
  const tabs = await chrome.tabs.query({ url: "https://chat.deepseek.com/*" });
  let tabId = tabs.find((t) => t.id != null)?.id;
  if (tabId == null) {
    const created = await chrome.tabs.create({ url: DEEPSEEK_WEB, active: false });
    if (created.id == null) throw new Error("无法打开 DeepSeek 网页版标签页");
    tabId = created.id;
  }
  for (let i = 0; i < 20; i++) {
    if (await pingWebTab(tabId)) return tabId;
    await sleep(1000);
  }
  throw new Error("DeepSeek 网页版未就绪：请打开该标签页确认已登录后重试");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callLLMWeb(messages: ChatMessage[]): Promise<string> {
  const { text, images } = flattenForWeb(messages);
  const tabId = await ensureWebTab();
  // 生成可能耗时数十秒，定时轻量调用防止 SW 空闲休眠
  const keepalive = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
  try {
    const resp = (await chrome.tabs.sendMessage(tabId, { type: "WEB_LLM_ASK", text, images })) as
      | { ok: boolean; text?: string; error?: string }
      | undefined;
    if (!resp?.ok || !resp.text) {
      throw new Error(`网页版调用失败：${resp?.error ?? "未知错误"}`);
    }
    return resp.text;
  } finally {
    clearInterval(keepalive);
  }
}
