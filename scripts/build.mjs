/**
 * 构建脚本：esbuild 打包四个入口为自包含单文件（MV3 插件标准做法）。
 * 不使用 @crxjs/vite-plugin —— 其 beta 版 chunk 拆分会把浏览器代码混进
 * Service Worker 加载链（window is not defined / loader 指错 chunk），已弃用。
 */

import * as esbuild from "esbuild";
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

mkdirSync(dist, { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  minify: false,
  logLevel: "info",
};

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/background/index.ts")],
  format: "esm", // MV3 service worker (manifest: type=module)
  outfile: join(dist, "background.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/content/index.ts")],
  format: "iife", // content script 为经典脚本
  outfile: join(dist, "content.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/content/deepseek.ts")],
  format: "iife", // chat.deepseek.com 网页版模式内容脚本
  outfile: join(dist, "content-deepseek.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/popup/main.ts")],
  format: "esm",
  outfile: join(dist, "popup.js"),
});

await esbuild.build({
  ...common,
  entryPoints: [join(root, "src/options/main.ts")],
  format: "esm",
  outfile: join(dist, "options.js"),
});

// manifest 与静态资源
cpSync(join(root, "manifest.json"), join(dist, "manifest.json"));
cpSync(join(root, "icons"), join(dist, "icons"), { recursive: true });
cpSync(join(root, "src/popup/index.html"), join(dist, "popup.html"));
cpSync(join(root, "src/options/index.html"), join(dist, "options.html"));
mkdirSync(join(dist, "data"), { recursive: true });
cpSync(join(root, "data/operators.json"), join(dist, "data/operators.json"));
cpSync(join(root, "data/aliases.json"), join(dist, "data/aliases.json"));

console.log("✓ dist 构建完成");
