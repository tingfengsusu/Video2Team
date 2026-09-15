/**
 * B站 wbi 签名（算法来自 bilibili-API-collect 社区文档的逆向结果）。
 * 2024+ 部分接口（view/reply）在 CDN 层校验 w_rid，无签名请求间歇性返回 412。
 *
 * 流程：GET /x/web-interface/nav 拿 wbi_img 种子 → 混排表生成 32 位 mixinKey
 *      → 参数按 key 排序 + wts 时间戳 → URL 编码拼接 + mixinKey 取 MD5 = w_rid。
 */

/** RFC 1321 MD5（crypto.subtle 无 MD5，内嵌实现） */
export function md5(input: string): string {
  const msg = new TextEncoder().encode(input);
  const len = msg.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Int32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;

  for (let off = 0; off < padded.length; off += 64) {
    const M = new Int32Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + K[i]! + M[g]!) | 0;
      A = D;
      D = C;
      C = B;
      B = (B + ((F << S[i]!) | (F >>> (32 - S[i]!)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }

  return [a0, b0, c0, d0]
    .map((x) => {
      const u = x >>> 0;
      let h = "";
      for (let i = 0; i < 4; i++) h += ((u >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
      return h;
    })
    .join("");
}

/** 官方 Web 端的固定混排索引表 */
const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
];

let cachedMixinKey: { key: string; ts: number } | null = null;

async function fetchMixinKey(): Promise<string> {
  if (cachedMixinKey && Date.now() - cachedMixinKey.ts < 3_600_000) return cachedMixinKey.key;
  const resp = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include" });
  const j = await resp.json();
  const imgKey = (j?.data?.wbi_img?.img_url ?? "").split("/").pop() ?? "";
  const subKey = (j?.data?.wbi_img?.sub_url ?? "").split("/").pop() ?? "";
  const raw = imgKey.replace(/\.\w+$/, "") + subKey.replace(/\.\w+$/, "");
  const mixin = MIXIN_TAB.map((n) => raw[n]).join("").slice(0, 32);
  cachedMixinKey = { key: mixin, ts: Date.now() };
  return mixin;
}

/** 对参数签名，返回带 wts/w_rid 的完整 query string */
export async function wbiSign(params: Record<string, string | number>): Promise<string> {
  const mixinKey = await fetchMixinKey();
  const withWts: Record<string, string | number> = { ...params, wts: Math.floor(Date.now() / 1000) };
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(withWts).sort(([a], [b]) => (a < b ? -1 : 1))) {
    query.append(k, String(v).replace(/[!'()*]/g, ""));
  }
  query.append("w_rid", md5(query.toString() + mixinKey));
  return query.toString();
}
