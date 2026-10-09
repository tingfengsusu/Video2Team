/**
 * 网格选关（第十一轮 q3）：像游戏里的「特别战线」那样，按**序号网格**点选派遣关——
 * 序号 = 从上到下、从左到右（灰格/白格同样占号），与识别依据用的是同一套编号。
 *
 * 用法（三个界面共用）：渲染层输出 `.gridpicker` 浮层与 `[data-act="open-grid"]` 按钮，
 * 这里只做交互：
 * - 点「▦ 按网格选关」打开；「取消」/ 点浮层背景 / Esc 关闭；
 * - 格子支持**单击**与**长按**（≥400ms，触屏/防误触）两种切换方式；
 * - 「查询并加入候选池」把选中的显示码交给 onApply（已在候选池里的格子是禁用的，避免重复查询）。
 */
const LONG_PRESS_MS = 400;

export function wireGridPicker(root: HTMLElement | Document, onApply: (codes: string[]) => void): void {
  const doc = root instanceof Document ? root : root.ownerDocument;

  const pickersIn = (): HTMLElement[] =>
    root instanceof Document
      ? [...root.querySelectorAll<HTMLElement>(".gridpicker")]
      : [...root.querySelectorAll<HTMLElement>(".gridpicker")];

  const sync = (picker: HTMLElement): void => {
    const cells = [...picker.querySelectorAll<HTMLButtonElement>(".gp-cell")];
    const on = cells.filter((c) => c.classList.contains("on"));
    const count = picker.querySelector<HTMLElement>(".gp-count b");
    if (count) count.textContent = String(on.length);
    const apply = picker.querySelector<HTMLButtonElement>('[data-act="apply-grid"]');
    if (apply) apply.disabled = on.length === 0;
  };

  const toggle = (cell: HTMLElement): void => {
    if (cell.hasAttribute("disabled")) return;
    cell.classList.toggle("on");
    const picker = cell.closest<HTMLElement>(".gridpicker");
    if (picker) sync(picker);
  };

  root.addEventListener("click", (e) => {
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
      const codes = [...picker.querySelectorAll<HTMLElement>(".gp-cell.on:not([disabled])")].map(
        (c) => c.dataset.code ?? "",
      );
      const list = [...new Set(codes.filter(Boolean))];
      if (!list.length) return;
      picker.hidden = true;
      onApply(list);
      return;
    }
    const cell = t.closest<HTMLElement>(".gp-cell");
    if (!cell) return;
    if (cell.dataset.longPressed) {
      delete cell.dataset.longPressed; // 这一次 click 是长按的收尾，别再切一次
      return;
    }
    toggle(cell);
  });

  // 长按 = 另一种选中方式（触屏没有 hover；也避免误触单击）。
  // ⚠️ 实测坑（第十一轮 q2）：不拦默认行为时长按会变成**选中文字/复制**，所以这里
  // preventDefault()（阻止选字，但不影响后续 click），并在浮层内禁掉右键/长按菜单。
  let timer: number | undefined;
  const clearTimer = (): void => {
    if (timer != null) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
  root.addEventListener("pointerdown", (e) => {
    const cell = (e.target as HTMLElement | null)?.closest<HTMLElement>(".gp-cell");
    if (!cell || cell.hasAttribute("disabled")) return;
    e.preventDefault();
    clearTimer();
    timer = window.setTimeout(() => {
      cell.dataset.longPressed = "1";
      toggle(cell);
    }, LONG_PRESS_MS);
  });
  root.addEventListener("contextmenu", (e) => {
    if ((e.target as HTMLElement | null)?.closest(".gridpicker")) e.preventDefault();
  });
  for (const evt of ["pointerup", "pointercancel", "pointerleave"]) {
    root.addEventListener(evt, clearTimer);
  }

  doc.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const picker of pickersIn()) if (!picker.hidden) picker.hidden = true;
  });
}
