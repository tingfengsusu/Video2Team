/**
 * 打包脚本：构建后把 dist/ 压缩为可分发的 Video2Team_v{version}.zip。
 * 用户拿到 zip 后解压，在 chrome://extensions 里「加载已解压的扩展程序」即可安装。
 * （上架 Edge 商店前的分发方式；PowerShell 压缩，Windows 开发机可直接用）
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const zipName = `Video2Team_v${pkg.version}.zip`;

console.log("① 构建 dist …");
execSync("node scripts/build.mjs", { cwd: root, stdio: "inherit" });

console.log(`② 压缩 → ${zipName}`);
const zipPath = join(root, zipName);
if (existsSync(zipPath)) rmSync(zipPath);
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path 'dist/*' -DestinationPath '${zipName}' -Force"`,
  { cwd: root, stdio: "inherit" },
);

console.log(`✓ 完成：${zipName}（解压后在浏览器「加载已解压的扩展程序」）`);
