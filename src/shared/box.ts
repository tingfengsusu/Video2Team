/**
 * box 导入（设计见 docs/design.md §3.2）。
 *
 * v1：SheetJS 解析一图流（ark.yituliu.cn）「我的干员 → 导出为 Excel」练度表，
 *     纯前端本地解析，数据不上传。该格式为标准输入格式（实测结构见 docs/notes/recon.md）。
 * v2：森空岛扫码 → 自动获取 cred → 签名调 API 拉干员数据。
 * cred 仅内存使用、不落盘；Excel 导入永久保留为兜底。
 */

import * as XLSX from "xlsx";
import type { Box, OperatorEntry } from "./types";

/** 一图流「干员练度表」的列名（2026-09 实测） */
const COL = {
  name: "干员名称",
  owned: "是否已招募",
  rarity: "星级",
  level: "等级",
  elite: "精英化等级",
  potential: "潜能等级",
  skillLevel: "通用技能等级",
  masteries: ["1技能专精等级", "2技能专精等级", "3技能专精等级"],
  modules: ["χ分支模组", "γ分支模组", "Δ分支模组", "α分支模组"],
} as const;

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * 「是否已招募」判定：一图流导出换过写法——
 *  旧版：布尔 true/false；新版（2026-10 实测）：字符串「是」/「否」。
 * 两种都要认，否则整表被过滤成 0 人（实测报「未解析到任何已招募干员」）。
 */
const OWNED_TRUE = new Set(["是", "已招募", "已拥有", "true", "yes", "y", "1", "√", "✓", "有"]);
const OWNED_FALSE = new Set(["否", "未招募", "未拥有", "false", "no", "n", "0", "×", "没有"]);

function isOwned(v: unknown): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;
  if (typeof v === "number") return v > 0;
  const s = String(v).trim().toLowerCase();
  if (!s) return false;
  if (OWNED_TRUE.has(s)) return true;
  if (OWNED_FALSE.has(s)) return false;
  return false; // 未知写法：按未招募处理（保守），但下面会校验"是否全被过滤"
}

export async function parseYituliuExcel(file: File): Promise<Box> {
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (rows.length === 0) throw new Error("练度表无数据行");

  // 关键列缺失时抛错并带实际表头，便于定位一图流格式变更（docs/design.md §10）
  const headers = Object.keys(rows[0]!);
  for (const key of [COL.name, COL.owned, COL.level, COL.elite]) {
    if (!headers.includes(key)) {
      throw new Error(`练度表缺少列「${key}」，一图流格式可能已变更。实际表头：${headers.join(" | ")}`);
    }
  }

  const operators: Record<string, OperatorEntry> = {};
  for (const row of rows) {
    const name = String(row[COL.name] ?? "").trim();
    // 练度表导出了全干员图鉴（实测 431 行中仅 244 已招募），未招募的必须过滤
    if (!name || !isOwned(row[COL.owned])) continue;
    operators[name] = {
      name,
      owned: true,
      rarity: num(row[COL.rarity]),
      level: num(row[COL.level]),
      elite: num(row[COL.elite]),
      potential: num(row[COL.potential]),
      skillLevel: num(row[COL.skillLevel]),
      masteries: COL.masteries.map((c) => num(row[c])),
      modules: COL.modules.map((c) => num(row[c])),
    };
  }

  if (Object.keys(operators).length === 0) {
    // 全部被过滤时，把该列的实际取值带出来，便于定位一图流格式变更
    const sample = rows
      .slice(0, 3)
      .map((r) => JSON.stringify(r[COL.owned]))
      .join("、");
    throw new Error(
      `未解析到任何已招募干员（「${COL.owned}」列前几行取值：${sample}）——` +
        "请确认导出的是「我的员工」→「我的干员」练度表；若格式已变请反馈给作者",
    );
  }
  return { operators, source: "excel" };
}

/** v2：森空岛扫码登录，自动获取 cred 并拉取绑定账号的干员数据 */
export async function importFromSkland(): Promise<Box> {
  throw new Error("not implemented: v2");
}
