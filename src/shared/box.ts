/**
 * box 导入（设计见 docs/design.md §3.2）。
 *
 * - v1：SheetJS 解析一图流（ark.yituliu.cn）「我的干员 → 导出为 Excel」练度表，
 *       纯前端本地解析，数据不上传。该格式为标准输入格式。
 * - v2：森空岛扫码 → 自动获取 cred → 签名调 API 拉干员数据
 *      （协议参考 https://github.com/ProbiusOfficial/Skland_API）。
 * - cred 仅内存使用、不落盘；Excel 导入永久保留为兜底。
 */

import type { Box } from "./types";

/** 解析一图流导出的 Excel 练度表（干员名/精英化/等级/专精） */
export async function parseYituliuExcel(file: File): Promise<Box> {
  throw new Error("not implemented: 待确认一图流 Excel 实际列格式（侦察任务）");
}

/** v2：森空岛扫码登录，自动获取 cred 并拉取绑定账号的干员数据 */
export async function importFromSkland(): Promise<Box> {
  throw new Error("not implemented: v2");
}
