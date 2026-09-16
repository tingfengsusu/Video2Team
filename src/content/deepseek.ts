/**
 * chat.deepseek.com 内容脚本（网页版模式）。
 *
 * - WEB_LLM_FILL：把提示词与截图填入输入框（发送由用户按回车完成）；
 * - WEB_LLM_WATCH：嗅探基线后观察新出现的 AI 回复，文本稳定 1.5 秒视为生成完毕，
 *   经 WEB_LLM_RESULT 回传后台（自动读取）；失败时用户仍可手动粘贴兜底。
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findInput(): HTMLTextAreaElement | null {
  return (
    document.querySelector<HTMLTextAreaElement>("#chat-input") ??
    document.querySelector<HTMLTextAreaElement>("textarea")
  );
}

function findFileInput(): HTMLInputElement | null {
  const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="file"]')];
  return inputs.find((i) => (i.accept || "").includes("image")) ?? inputs[0] ?? null;
}

/** React 受控组件：必须走原生 setter 才能触发状态更新 */
function setNativeValue(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function fill(text: string, images: string[]): Promise<{ ok: boolean; error?: string }> {
  const ta = findInput();
  if (!ta) return { ok: false, error: "未找到对话框：请确认已登录 chat.deepseek.com" };

  if (images.length) {
    const fi = findFileInput();
    if (!fi) return { ok: false, error: "未找到图片上传入口（DeepSeek 页面结构可能已更新）" };
    try {
      const dt = new DataTransfer();
      for (const [i, url] of images.entries()) {
        const blob = await (await fetch(url)).blob();
        dt.items.add(new File([blob], `screenshot-${i + 1}.jpg`, { type: blob.type || "image/jpeg" }));
      }
      fi.files = dt.files;
      fi.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1500); // 等图片进入输入区
    } catch (e) {
      return { ok: false, error: "截图附加失败：" + (e as Error).message };
    }
  }

  ta.focus();
  setNativeValue(ta, text);
  return { ok: true };
}

// ---------- 自动读取回复 ----------

let watchToken = 0;

function replyCount(): number {
  return document.querySelectorAll(".ds-markdown").length;
}

function lastReplyText(): string {
  const nodes = document.querySelectorAll(".ds-markdown");
  return nodes.length ? (nodes[nodes.length - 1] as HTMLElement).innerText.trim() : "";
}

/** 嗅探基线 → 等待新回复出现并稳定 → 回传后台。
 *  双条件检测（节点数增加 或 末尾回复文本变化），兼容「同一会话追加回复」等 DOM 复用场景。 */
async function watchReply(timeoutMs: number): Promise<void> {
  const token = ++watchToken;
  const baselineCount = replyCount();
  const baselineText = lastReplyText(); // 文本快照：节点复用但内容变化也能识别
  const t0 = Date.now();
  let last = "";
  let stableSince = 0;
  while (Date.now() - t0 < timeoutMs && token === watchToken) {
    await sleep(1000);
    const cur = lastReplyText();
    if (!cur) continue;
    const isNew = replyCount() > baselineCount || cur !== baselineText;
    if (!isNew) continue;
    if (cur === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 1500) {
        // 文本连续 1.5 秒未变化 → 生成结束
        void chrome.runtime.sendMessage({ type: "WEB_LLM_RESULT", text: cur });
        return;
      }
    } else {
      last = cur;
      stableSince = 0;
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "WEB_LLM_PING") {
    sendResponse({ ok: true, ready: !!findInput() });
    return;
  }
  if (msg?.type === "WEB_LLM_FILL") {
    void fill(msg.text ?? "", msg.images ?? []).then(sendResponse);
    return true;
  }
  if (msg?.type === "WEB_LLM_WATCH") {
    void watchReply(typeof msg.timeoutMs === "number" ? msg.timeoutMs : 300_000);
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "WEB_LLM_WATCH_STOP") {
    watchToken++; // 使当前 watcher 失效
    sendResponse({ ok: true });
    return;
  }
});
