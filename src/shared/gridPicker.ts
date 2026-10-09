/**
 * 网格选关（第十一轮 q3 新增，第十二轮 p1 更新）：像游戏里的「特别战线」那样按**序号网格**选关——
 * 序号 = 从上到下、从左到右（灰格/白格同样占号），与识别依据用的是同一套编号。
 *
 * 交互：
 * - 点「按网格选关」打开；「取消」/ 点浮层背景 / Esc 关闭；
 * - **单击**切换一格；**按住拖动**连续点选（滑过哪些格就选哪些，拖过已选的还能整段取消）；
 * - 已在候选池的格子默认勾着（`data-in-pool`），可以取消勾选，但**应用时不会重复查询**；
 * - 「查询并加入候选池」只把"新选中且不在池里"的关交给 onApply；
 * - 长按/拖动不会变成选中文字（pointerdown preventDefault + 浮层内拦 contextmenu + CSS user-select:none）。
 */
export function wireGridPicker(root: HTMLElement, onApply: (codes: string[]) => void): void {
  const doc = root.ownerDocument;
  const pickersIn = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(".gridpicker")];
  const cellOf = (t: EventTarget | null): HTMLElement | null =>
    (t as HTMLElement | null)?.closest?.(".gp-cell") ?? null;
  const pickerOf = (el: HTMLElement | null): HTMLElement | null =>
    el?.closest<HTMLElement>(".gridpicker") ?? null;

  const sync = (picker: HTMLElement): void => {
    const cells = [...picker.querySelectorAll<HTMLElement>(".gp-cell")];
    const on = cells.filter((c) => c.classList.contains("on"));
    const fresh = on.filter((c) => c.dataset.inPool !== "1");
    const count = picker.querySelector<HTMLElement>(".gp-count b");
    if (count) count.textContent = String(on.length);
    const extra = picker.querySelector<HTMLElement>(".gp-new");
    if (extra) {
      extra.textContent = fresh.length
        ? `（其中 ${fresh.length} 关将查询）`
        : on.length
          ? "（都已在候选池）"
          : "";
    }
    const apply = picker.querySelector<HTMLButtonElement>('[data-act="apply-grid"]');
    if (apply) apply.disabled = fresh.length === 0;
  };

  // 按住拖动 = 连续点选：pointerdown 定方向（该格原来开着就整段取消，否则整段选中），
  // pointermove 用 elementFromPoint 找当前滑过的格子（触屏没有 pointerover）。
  let dragMode: "on" | "off" | null = null;
  let lastCell: HTMLElement | null = null;
  const paint = (cell: HTMLElement, mode: "on" | "off"): void => {
    cell.classList.toggle("on", mode === "on");
    const picker = pickerOf(cell);
    if (picker) sync(picker);
  };
  const endDrag = (): void => {
    dragMode = null;
    lastCell = null;
  };

  root.addEventListener("pointerdown", (e: PointerEvent) => {
    const cell = cellOf(e.target);
    if (!cell) return;
    e.preventDefault(); // 阻止选字/原生拖拽；不影响后续的 keydown 与链接
    dragMode = cell.classList.contains("on") ? "off" : "on";
    lastCell = cell;
    paint(cell, dragMode);
  });
  root.addEventListener("pointermove", (e: PointerEvent) => {
    if (!dragMode) return;
    e.preventDefault();
    const cell = cellOf(doc.elementFromPoint(e.clientX, e.clientY));
    if (!cell || cell === lastCell) return;
    lastCell = cell;
    paint(cell, dragMode);
  });
  for (const evt of ["pointerup", "pointercancel", "pointerleave"]) root.addEventListener(evt, endDrag);

  // 键盘可达：Tab 到格子后回车/空格切换
  root.addEventListener("keydown", (e: KeyboardEvent) => {
    const cell = cellOf(e.target);
    if (!cell) return;
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    cell.classList.toggle("on");
    const picker = pickerOf(cell);
    if (picker) sync(picker);
  });

  root.addEventListener("click", (e: MouseEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return;
    if (t.closest('[data-act="open-grid"]')) {
      const picker = pickersIn()[0];
      if (picker) {
        picker.hidden = false;
        sync(picker);
      }
      return;
    }
    const picker = t.closest<HTMLElement>(".gridpicker");
    if (!picker) return;
    if (t.closest('[data-act="close-grid"]') || t === picker) {
      picker.hidden = true;
      return;
    }
    if (t.closest('[data-act="apply-grid"]')) {
      const codes = [...picker.querySelectorAll<HTMLElement>(".gp-cell.on:not([data-in-pool])")].map(
        (c) => c.dataset.code ?? "",
      );
      const list = [...new Set(codes.filter(Boolean))];
      if (!list.length) return;
      picker.hidden = true;
      onApply(list);
      return;
    }
    // 格子本身：切换已经在 pointerdown 里做过，这里不再切（避免一次点击切两下）
  });

  root.addEventListener("contextmenu", (e: MouseEvent) => {
    if ((e.target as HTMLElement | null)?.closest(".gridpicker")) e.preventDefault();
  });

  doc.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;
    for (const picker of pickersIn()) if (!picker.hidden) picker.hidden = true;
  });
}
