/**
 * chat.deepseek.com 内容脚本（网页版模式）。
 *
 * 只做一件事：把提示词与截图**填入**输入框（WEB_LLM_FILL）。
 * 发送与等待回复由用户手动完成（更简单、不依赖页面状态探测），
 * 用户再把回复粘贴回插件继续流程。
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "WEB_LLM_PING") {
    sendResponse({ ok: true, ready: !!findInput() });
    return;
  }
  if (msg?.type === "WEB_LLM_FILL") {
    void fill(msg.text ?? "", msg.images ?? []).then(sendResponse);
    return true;
  }
});
