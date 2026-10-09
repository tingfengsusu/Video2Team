/**
 * 把本地截图传到图片仓库（tingfengsusu/photo），并打印可直接贴进 markdown 的 URL。
 *
 *   node scripts/upload-photo.mjs [本地目录] [仓库内目录]
 *   默认：docs/promo-images-v2  →  video2team/v0.3.0
 *
 * 说明：用 GitHub Contents API（PUT），已存在会更新（自动带 sha）——所以**换真图时保持文件名不变**，
 * 重新跑一次这个脚本即可，帖子里的链接不用改。
 * token 取自 `git credential fill`（与推送脚本同一套）。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const REPO = "tingfengsusu/photo";
const BRANCH = "main";
const localDir = process.argv[2] ?? "docs/promo-images-v2";
const remoteDir = (process.argv[3] ?? "video2team/v0.3.0").replace(/^\/+|\/+$/g, "");

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp" };

function token() {
  const out = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n",
    encoding: "utf8",
  });
  const m = out.match(/^password=(.+)$/m);
  if (!m) throw new Error("git credential 里没有 password（token）");
  return m[1].trim();
}
const TOKEN = token();
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "User-Agent": "video2team-upload",
  "Content-Type": "application/json",
};
const api = async (path, init = {}) => {
  const res = await fetch(`https://api.github.com${path}`, { ...init, headers });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${text.slice(0, 200)}`);
  return json;
};

const files = readdirSync(localDir)
  .filter((f) => MIME[extname(f).toLowerCase()] && statSync(join(localDir, f)).isFile())
  .sort();
if (!files.length) throw new Error(`目录里没有图片：${localDir}`);

const rows = [];
for (const file of files) {
  const path = `${remoteDir}/${basename(file)}`;
  const content = readFileSync(join(localDir, file));
  let sha;
  try {
    sha = (await api(`/repos/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`)).sha;
  } catch {
    sha = undefined; // 新文件
  }
  await api(`/repos/${REPO}/contents/${encodeURI(path)}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `${sha ? "更新" : "新增"} ${path}`,
      content: content.toString("base64"),
      branch: BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  const cdn = `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/${path}`;
  const raw = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
  rows.push({ file, path, cdn, raw, size: content.length });
  console.log(`${sha ? "更新" : "新增"} ${path}（${Math.round(content.length / 1024)} KB）`);
}

console.log("\n—— markdown 用（jsdelivr，国内更稳）——");
for (const r of rows) console.log(`![${basename(r.file, extname(r.file))}](${r.cdn})`);
console.log("\n—— raw 备用 ——");
for (const r of rows) console.log(r.raw);
