/**
 * 候选池折叠块：**鼠标悬浮即展开**（第十轮 q3：减少"先点一下"的操作量）。
 *
 * 规则：
 * - 悬浮到 `details[data-hover]` 上 → 展开；移出整块 → 收起；
 * - 点过摘要的块按点击后的状态"钉住"（不再自动收起），再点一次恢复悬浮展开；
 * - 关键操作不依赖 hover：勾选框、链接、整行点选都还是普通点击，悬浮只是让内容先露出来。
 */
export function wireHoverDetails(root: HTMLElement | Document): void {
  root.addEventListener("mouseover", (e) => {
    const d = (e.target as HTMLElement | null)?.closest?.("details[data-hover]") as HTMLDetailsElement | null;
    if (d && !d.open) d.open = true;
  });
  root.addEventListener("mouseout", (e) => {
    const d = (e.target as HTMLElement | null)?.closest?.("details[data-hover]") as HTMLDetailsElement | null;
    if (!d || d.dataset.pinned === "1") return;
    const to = (e as MouseEvent).relatedTarget as Node | null;
    if (to && d.contains(to)) return; // 还在块内移动，不算移出
    d.open = false;
  });
  // 点击摘要 = 固定成点击后的状态（原生 toggle 是默认行为，在监听器之后执行，所以这里读到的还是旧值）
  root.addEventListener("click", (e) => {
    const summary = (e.target as HTMLElement | null)?.closest?.("summary");
    const d = summary?.parentElement as HTMLDetailsElement | null;
    if (d && d.dataset && d.dataset.hover === "1") d.dataset.pinned = d.open ? "0" : "1";
  });
}
