/**
 * chat.deepseek.com 内容脚本（网页版模式，实验性）。
 *
 * 接收后台 WEB_LLM_ASK {text, images[]}：
 *  填写输入框（React 受控组件用原生 setter）→ 附加截图（DataTransfer 注入 file input）
 *  → 发送（Enter 优先，回退点击发送按钮）→ 轮询等待回复文本稳定 → 返回。
 * 选择器带多级回退；页面结构变更时返回明确错误，引导切回 API 模式。
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

function lastAssistantText(): string {
  const nodes = document.querySelectorAll(".ds-markdown");
  return nodes.length ? (nodes[nodes.length - 1] as HTMLElement).innerText : "";
}

function clickSend(): boolean {
  const ta = findInput();
  if (!ta) return false;
  let scope: HTMLElement | null = ta.parentElement;
  for (let depth = 0; depth < 6 && scope; depth++) {
    const btns = [...scope.querySelectorAll<HTMLElement>('div[role="button"], button')].filter(
      (b) => !(b as HTMLButtonElement).disabled && b.getAttribute("aria-disabled") !== "true",
    );
    if (btns.length) {
      btns[btns.length - 1]!.click(); // 发送按钮通常在最右侧
      return true;
    }
    scope = scope.parentElement;
  }
  return false;
}

async function waitForReply(before: string, timeoutMs: number): Promise<string | null> {
  const t0 = Date.now();
  let last = "";
  let stableSince = 0;
  while (Date.now() - t0 < timeoutMs) {
    await sleep(1000);
    const cur = lastAssistantText();
    if (!cur || cur === before) continue;
    if (cur === last) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 2000) return cur; // 文本稳定 2 秒视为生成结束
    } else {
      last = cur;
      stableSince = 0;
    }
  }
  return last && last !== before ? last : null;
}

async function ask(text: string, images: string[]): Promise<{ ok: boolean; text?: string; error?: string }> {
  const ta = findInput();
  if (!ta) {
    return { ok: false, error: "未找到对话框：请确认打开的 chat.deepseek.com 页面已登录" };
  }

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
      await sleep(2000); // 等图片进入输入区
    } catch (e) {
      return { ok: false, error: "截图附加失败：" + (e as Error).message };
    }
  }

  const before = lastAssistantText();
  ta.focus();
  setNativeValue(ta, text);
  await sleep(400);

  // Enter 优先（DeepSeek 网页端默认回车发送），未生效则点发送按钮
  ta.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }),
  );
  await sleep(1500);
  if (lastAssistantText() === before) clickSend();

  const reply = await waitForReply(before, 240_000);
  if (!reply) return { ok: false, error: "等待回复超时（可能触发验证/限流，请到页面查看）" };
  return { ok: true, text: reply };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "WEB_LLM_PING") {
    sendResponse({ ok: true, ready: !!findInput() });
    return;
  }
  if (msg?.type === "WEB_LLM_ASK") {
    void ask(msg.text ?? "", msg.images ?? []).then(sendResponse);
    return true; // 异步响应（生成可能耗时数十秒）
  }
});
