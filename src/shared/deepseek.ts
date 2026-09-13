/**
 * DeepSeek API 调用（API key 存 chrome.storage，options 页设置）。
 * prompt 设计可参考 Video2Shop 的 recipe_extractor（提取食材 → 提取阵容/替代映射）。
 */

const API_URL = "https://api.deepseek.com/chat/completions";

export async function callDeepSeek(
  messages: Array<{ role: string; content: string }>,
  options?: { images?: string[]; timeoutMs?: number },
): Promise<string> {
  throw new Error("not implemented");
}
