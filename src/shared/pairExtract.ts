/**
 * 替代建议的**程序化召回**（第十六轮 q2，2026-10-09）。
 *
 * 背景（用户实测 + 两份日志逐条对比）：同一条弹幕（「珊比可以替52」）两次分析都在候选列表里，
 * 但模型昨天没为它产出条目、今天产出了 —— 不是截断、也不是别名表缺称呼，
 * 根因是**让模型从 50-60 行里自由「找」建议，召回不稳定**（同一输入两次差 10 条：昨天只覆盖
 * 3 个干员，今天覆盖 8 个）。
 *
 * 对策：把「召回」从模型手里拿回来 —— 本模块用**纯程序**（零 token）按固定句式抽出「X 替/换 Y」，
 * 再由调用方把结果作为**清单**塞进提示词、并把模型没有否决的那些**并进最终结果**（见 miner.ts）。
 *
 * 定向规则（关键）：中文「A 可换 B」两种读法都合法（A 换成 B / A 换掉 B），靠**阵容**消歧——
 * `removed` 必须是本关阵容里的干员：
 *   ① 只有一侧在阵容里 → 那一侧就是被替代者（实测能覆盖绝大多数句式）；
 *   ② 两侧都在阵容里 → **放弃**（方向只能靠语感，实测模型对这类句式判断正确，且猜错会给出反向建议）；
 *   ③ 都不在阵容里 / 任一侧解析不出干员 → 放弃（宁可漏，不可错——漏了的模型仍有机会补）。
 *
 * 三道降噪：分句（替代关系不跨句）、疑问句过滤、动词两侧各限 12 字窗口
 * （实测：长句缺逗号时右窗口会捞到十几字外的另一个干员，配出反向的错对）。
 * 规则在用户提供的真实弹幕（VEC-C，57 条候选）上逐条核对过，见 scripts/v43-selftest.mjs。
 */

import { matchOperatorsDetailed, type NameDict } from "./biliDig";

export interface ExtractedPair {
  /** 被替代者（已按阵容归一：阵容里只有异格版本时用阵容里的名字） */
  from: string;
  /** 替代者（同样优先用阵容里的异格名字） */
  to: string;
  /** 动词在原文里的位置（稳定排序/调试用） */
  at: number;
}

/** 分句：替代关系基本不跨句，按标点切开可避免「逗号另一头」的名字被误配 */
const CLAUSE_SEP = /[，。；!！?？,;、…~～]/;

/** 疑问/求助句：句尾问号/吗呢，或含「换谁/能不能」等 —— 不是建议，整句跳过
 *  （实测噪声：「所以德狗可以换凛冬吗？」「凛冬能换斩熊吗」「瑶可以换谁」） */
const QUESTION = /([？?]|吗|呢)\s*$|换谁|谁可以|能不能|求问|请问|问一下|求教/;

/** 替代动词（长的在前：`替换` 不该被拆成 `换`） */
const VERB = /(替换|替代|代替|平替|下位|换成|换上|换|替)/g;

/** 动词两侧各自只看这么多字：长句缺逗号时（如「银灰可换yns二唯一的难点是助战刷烛煌」）
 *  窗口外那个干员跟这次替换无关，捞进来会配出反向的错对 */
const WINDOW = 12;

/** 动词前紧邻否定词 → 不是"建议换"，是"别换"
 *  （实测：「留烛煌不要换小逻朝上可以替初雪」） */
const NEGATED = /(不要|不用|别|甭|无需|不能|不可以)\s*$/;

/** 候选文本带的 `[弹幕 03:12] ` 前缀（buildCandidates 拼上去的）不参与解析 */
export function stripDanmakuPrefix(text: string): string {
  return String(text ?? "").replace(/^\[弹幕\s*\d{1,2}:\d{2}\]\s*/, "");
}

/** 内部沿用短名 */
const stripPrefix = stripDanmakuPrefix;

/** 名字 → 阵容里的写法：精确命中先用；否则取"阵容名包含该名"的那个（星熊→斩业星熊、银灰→凛御银灰） */
function toRosterName(name: string, rosterNames: string[]): string | null {
  if (rosterNames.includes(name)) return name;
  return rosterNames.find((n) => n.includes(name)) ?? null;
}

/** 贴在动词前的语气/助动词：单字干员名被它们顶开时通用匹配会漏
 *  （「黍**可**换塞雷娅」「高练度林**可以**替烛煌」——通用匹配要求"单字名两侧独立"，
 *  这里按位置先剥掉助词再看贴动词的那个字） */
const MODAL_TAIL = /(?:可以|可|能|会|也|都|应该|貌似|感觉|可能|大概|需要|想|要|就|即|直接|其实|基本上|只)+$/;
/** 右侧窗口的开头标点/空格 */
const LEADING_JUNK = /^[\s，,。.、:：;；~～\-]+/;

/**
 * 窗口内离动词最近的名字；正常匹配取不到时，再看窗口**贴动词的那一个字**是不是单字干员名。
 */
function nearestOp(
  text: string,
  dict: NameDict,
  single: Set<string>,
  side: "left" | "right",
): string | null {
  const ops = matchOperatorsDetailed(text, dict);
  if (ops.length) return (side === "left" ? ops[ops.length - 1] : ops[0])!.full;
  const edge = side === "left" ? text.replace(MODAL_TAIL, "").slice(-1) : text.replace(LEADING_JUNK, "").slice(0, 1);
  return single.has(edge) ? edge : null;
}

/**
 * 从一段候选文本里抽出替代对（可能 0 条，也可能一句里两条）。
 * 只做"高置信"抽取：含替代动词、动词两侧都能解析出真实干员、被替代者在阵容里、且方向唯一。
 */
export function extractPairs(text: string, rosterNames: string[], dict: NameDict): ExtractedPair[] {
  if (!rosterNames.length) return [];
  const raw = stripPrefix(text);
  if (!raw) return [];

  const single = new Set(dict.names().filter((n) => n.length === 1));
  const out: ExtractedPair[] = [];
  const seen = new Set<string>();

  let base = 0; // 分句后的全局偏移（at 用）
  for (const clause of raw.split(CLAUSE_SEP)) {
    const clauseStart = base;
    base += clause.length + 1; // +1：分隔符本身
    if (!clause || QUESTION.test(clause)) continue;

    for (const m of clause.matchAll(VERB)) {
      const verb = m[1] ?? "";
      const at = m.index ?? 0;
      const left = clause.slice(Math.max(0, at - WINDOW), at);
      const right = clause.slice(at + verb.length, at + verb.length + WINDOW);
      if (NEGATED.test(left)) continue; // 「不要换/别换」= 反建议
      const L = nearestOp(left, dict, single, "left");
      const R = nearestOp(right, dict, single, "right");
      if (!L || !R) continue; // 任一侧没干员名 → 放弃（实测可挡掉「放黍旁边就行」这类误配）

      const Lr = toRosterName(L, rosterNames);
      const Rr = toRosterName(R, rosterNames);
      // ① 只有一侧在阵容里 → 它才是被替代者；② 两侧都在/都不在 → 不猜（交给模型）
      const fromRaw = Lr && !Rr ? Lr : !Lr && Rr ? Rr : null;
      if (!fromRaw) continue;
      const to = toRosterName(fromRaw === Lr ? R : L, rosterNames) ?? (fromRaw === Lr ? R : L);
      if (!to || fromRaw === to) continue;
      const key = `${fromRaw}\u0000${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ from: fromRaw, to, at: clauseStart + at });
    }
  }
  return out;
}
