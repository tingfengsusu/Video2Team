/**
 * 「点开查看」这类**就地展开**（第十三轮 q1）：
 * 候选池里被「缺干员」过滤掉的方案默认折叠，点一下在同一关卡块里展开/收起——
 * 用户自己搜到的攻略可能就在里边，看一眼不用重新分析。
 */
export function wireShowHidden(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const link = (e.target as HTMLElement | null)?.closest?.('[data-act="show-hidden"]');
    if (!link) return;
    e.preventDefault();
    const pool = link.closest(".stagepool");
    const box = pool?.querySelector<HTMLElement>("[data-hidden-schemes]");
    if (!box) return;
    box.hidden = !box.hidden;
    link.textContent = box.hidden ? "点开查看" : "收起";
  });
}
