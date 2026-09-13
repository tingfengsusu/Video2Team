/**
 * 设置页逻辑：API key 保存（chrome.storage.local）+ Excel box 导入（box.parseYituliuExcel）。
 */

import { parseYituliuExcel } from "../shared/box";

const $ = (id: string) => document.getElementById(id)!;

async function init(): Promise<void> {
  // API key 回显与保存
  const apiKeyInput = $("apiKey") as HTMLInputElement;
  const { apiKey } = await chrome.storage.local.get("apiKey");
  apiKeyInput.value = typeof apiKey === "string" ? apiKey : "";

  $("saveKey").addEventListener("click", async () => {
    await chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() });
    $("keyStatus").textContent = "已保存 ✓";
    setTimeout(() => ($("keyStatus").textContent = ""), 2000);
  });

  // box 导入状态回显
  const { box } = await chrome.storage.local.get("box");
  renderBoxStatus(box);

  // Excel 导入（纯本地解析）
  $("excelFile").addEventListener("change", async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    $("boxError").textContent = "";
    $("boxStatus").textContent = "解析中…";
    try {
      const parsed = await parseYituliuExcel(file);
      await chrome.storage.local.set({ box: parsed });
      renderBoxStatus(parsed);
    } catch (err) {
      $("boxStatus").textContent = "";
      $("boxError").textContent = `导入失败：${(err as Error).message}`;
    }
  });
}

function renderBoxStatus(box: any): void {
  const count = box?.operators ? Object.keys(box.operators).length : 0;
  $("boxStatus").textContent =
    count > 0 ? `已导入 ${count} 名干员（来源：${box.source === "excel" ? "一图流 Excel" : "森空岛"}）` : "尚未导入";
}

init();
