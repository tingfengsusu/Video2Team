/**
 * §9.5 干员名修饰词清洗。
 *
 * 实测问题：练度/配置修饰词被并进名字（「高练机械师」）→ 字典校验失败 → 误进昵称纠错队列。
 * 双层修复：
 *   ① 提取 prompt 明确要求剥离修饰词（roster.ts / miner.ts）；
 *   ② 程序层兜底 `stripModifiers()`：**字典校验前**剥离修饰前缀/后缀/括号重试匹配，
 *      命中则正常使用，**不写入 corrections_pending**（见 operatorDB.resolve）。
 *
 * 保守原则：只剥「整词」修饰（高练/专三/满配/3级…），不剥单字（干员「小满」结尾就是「满」）；
 * 且调用方只在原名查不到字典时才用剥离结果，绝不会把已识别的真名改错。
 */

/** 练度/配置修饰词（整词，避免误伤真名） */
const MODIFIER_WORDS = [
  "高练", "低练", "满练", "满配", "满潜", "满级", "满模组", "满模",
  "专一", "专二", "专三", "专九",
  "精零", "精一", "精二",
  "模组", "三模", "二模", "一模",
];

/** 数值型修饰：3级 / 三级 / 三潜 / 满潜3 …（N 级 / N 潜 / N 模组） */
const NUM = "0-9０-９一二三四五六七八九十";
const HEAD_NUMERIC = new RegExp(`^[${NUM}]{1,2}(?:级|潜|模|模组)`);
const TAIL_NUMERIC = new RegExp(`[${NUM}]{1,2}(?:级|潜|模|模组)$`);

function leadingModifier(name: string): string | null {
  const word = MODIFIER_WORDS.find((w) => name.startsWith(w));
  if (word) return word;
  return name.match(HEAD_NUMERIC)?.[0] ?? null;
}

function trailingModifier(name: string): string | null {
  const word = MODIFIER_WORDS.find((w) => name.endsWith(w));
  if (word) return word;
  return name.match(TAIL_NUMERIC)?.[0] ?? null;
}

function isModifierToken(token: string): boolean {
  const t = token.trim();
  if (!t) return false;
  return MODIFIER_WORDS.includes(t) || HEAD_NUMERIC.test(t) || TAIL_NUMERIC.test(t);
}

/** 括号里只有修饰词时整块剥离：机械师（专三）→ 机械师 */
function stripParenthesized(name: string): string {
  return name.replace(/[（(]\s*([^（()）]{1,8}?)\s*[）)]\s*$/, (whole, inner: string) =>
    isModifierToken(inner) ? "" : whole,
  );
}

/** 剥离首尾的练度修饰词与连接符（高练机械师 → 机械师；机械师·满配 → 机械师）。 */
export function stripModifiers(raw: string): string {
  let name = stripParenthesized(String(raw ?? "").trim());
  for (let i = 0; i < 4 && name; i += 1) {
    name = name.replace(/^[·・,，、:：/／\s]+/, "").replace(/[·・,，、:：/／\s]+$/, "");
    const head = leadingModifier(name);
    if (head) {
      name = name.slice(head.length).replace(/^的/, "").trim();
      continue;
    }
    const tail = trailingModifier(name);
    if (tail) {
      name = name.slice(0, name.length - tail.length).trim();
      continue;
    }
    break;
  }
  return stripParenthesized(name).trim();
}
