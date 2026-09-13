/**
 * DeepSeek API 调用（API key 存 chrome.storage.local，options 页设置）。
 * prompt 设计参考 Video2Shop 的 recipe_extractor（提取食材 → 提取阵容/替代映射）。
 */

const API_URL = "https://api.deepseek.com/chat/completions";
const MODEL = "deepseek-v4-flash";

export async function getApiKey(): Promise<string> {
  const { apiKey } = await chrome.storage.local.get("apiKey");
  return typeof apiKey === "string" ? apiKey : "";
}

export type MessageContent =
  | string
  | Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }>;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

export async function callDeepSeek(
  messages: ChatMessage[],
  options?: { timeoutMs?: number },
): Promise<string> {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error("未配置 DeepSeek API Key，请右键插件图标打开「选项」填写");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 120_000);
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`DeepSeek API ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("DeepSeek 返回格式异常");
    return content;
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
