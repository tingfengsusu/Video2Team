/**
 * 结果渲染（纯字符串生成，popup 与 content 页内面板共用）。
 *
 * 着色约定（用户要求，2026-09-13）：**干员名字体颜色** = 是否在你 box：
 * 绿色(.own) = 你有，红色(.miss) = 你没有。背景不做红绿（避免混淆），
 * 状态仅用左侧色条区分（保留/替换/无解）。
 * 派遣占用（矢量突破类活动）：被派遣锁定的干员名 = 灰色 + 删除线 + 🔒 徽章（悬停显示锁在哪个关），
 * 即「占用清单为空时结果区看不出过滤效果」的实时反馈（§9.3/§9.4）。
 */

import type { AnalysisOutput, LockedOps, RecommendedSlot, Substitution } from "./types";
import type { StageKind } from "./stageKind";
import {
  isLockLabelOfStage,
  type DispatchPicks,
} from "./dispatchPicks";
import {
  SOURCE_TIPS,
  maaLevelUrl,
  schemeKeyOf,
  schemeSourceUrl,
  type MergedScheme,
  type MergedStagePool,
} from "./dispatchPool";

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export type HasOp = (name: string) => boolean;

/** 内联样式（优先级最高，不依赖 CSS 类是否加载/更新） */
const OWN_STYLE = "color:#1a7f37;font-weight:700";
const MISS_STYLE = "color:#c0392b;font-weight:700";
/** 被派遣占用：灰色 + 删除线（§9.3 视觉定义 .occupied） */
const OCCUPIED_STYLE = "color:#999;text-decoration:line-through";

/** 干员名（按是否持有着色——内联样式，绿=你有 红=你没有；被派遣则灰+删除线+🔒） */
function nameSpan(name: string, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  const lockStage = lockedOps[name];
  if (lockStage) {
    return (
      `<span class="occupied" style="${OCCUPIED_STYLE}">${esc(name)}</span>` +
      `<span class="lockbadge" style="color:#b8860b" title="已派遣：${esc(lockStage)}">🔒</span>`
    );
  }
  const owned = hasOp(name);
  return `<span class="${owned ? "own" : "miss"}" style="${owned ? OWN_STYLE : MISS_STYLE}">${esc(name)}</span>`;
}

function srcLabel(s: Substitution): string {
  const src = s.source === "pinned" ? "置顶评论" : s.source === "danmaku" ? "弹幕" : "评论区";
  return s.likes ? `${src}·${s.likes}赞` : src;
}

/** 建议行的元信息尾部：来源 + 溯源链接 + 原文引用 */
/** 建议的来源与原文：**另起一行**（第十五轮 q3：追加在主行后面读起来很挤） */
function substMeta(s: Substitution): string {
  const link = s.evidenceUrl ? ` <a href="${esc(s.evidenceUrl)}" target="_blank">溯源</a>` : "";
  return (
    `<span class="dim subst-meta" style="display:block;margin-top:1px">` +
    `（${esc(srcLabel(s))}）${link}<span class="quote">“${esc(s.evidence.slice(0, 40))}”</span></span>`
  );
}

/** 一条独立成行的实战建议（替代者名着色 + 占用徽章） */
export function renderSubLine(s: Substitution, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  return `<div class="sub-line">${nameSpan(s.replacement, hasOp, lockedOps)}${substMeta(s)}</div>`;
}

export function renderSlot(slot: RecommendedSlot, hasOp: HasOp, lockedOps: LockedOps = {}): string {
  const op = nameSpan(slot.original.operator, hasOp, lockedOps);
  const keyTag = slot.original.isKey ? " <b>关键</b>" : "";
  const supTag = slot.original.support ? " <i>助战</i>" : "";
  const alts = slot.alternatives.length
    ? `<div class="alts"><span class="dim">其他实战建议：</span>${slot.alternatives
        .map((s) => renderSubLine(s, hasOp, lockedOps))
        .join("")}</div>`
    : "";

  if (slot.status === "keep") {
    return `<div class="slot keep">✓ ${op}${keyTag}${supTag} — 你有，保留</div>`;
  }
  if (slot.status === "substituted" && slot.via && "source" in slot.via) {
    return (
      `<div class="slot sub">⚠ ${op}${keyTag}${supTag} → <b>${nameSpan(slot.finalOperator!, hasOp, lockedOps)}</b>${substMeta(slot.via)}` +
      (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
      alts +
      `</div>`
    );
  }
  return (
    `<div class="slot unresolved">✗ ${op}${keyTag}${supTag} — 无解` +
    (slot.note ? `<div class="note">${esc(slot.note)}</div>` : "") +
    (slot.alternatives.length
      ? `<div class="alts"><span class="dim">实战建议：</span>${slot.alternatives
          .map((s) => renderSubLine(s, hasOp, lockedOps))
          .join("")}</div>`
      : "") +
    `</div>`
  );
}

export interface ResultRenderOptions {
  stageKind?: StageKind;
  ambiguousDispatch?: boolean;
  /** §9.3 候选池勾选态（关卡显示码 → 已勾选方案） */
  picks?: DispatchPicks;
  /** 隐藏「不可抄」的方案（缺干员 / 被其它关占用）；设置页可关 */
  hideUnavailable?: boolean;
  /** 每关最多显示几条方案（默认 12，替代原先的 3+3=6 上限） */
  maxSchemeRows?: number;
  /** MAA 与 B站 标识用不同颜色（蓝/粉）；设置页可关 */
  colorBySource?: boolean;
  /** 是否输出渲染层的分区标题（大窗口页用卡片标题时置 false） */
  showGuidesHeading?: boolean;
  /** 每关识别依据（特别战线网格位置 / 格内名称），让「识别错了」可见可纠 */
  guideEvidence?: Record<string, string>;
  /** 用户手动排除的关卡显示码 */
  excludedStages?: string[];
  /** 本活动全部派遣关（供「＋ 补一个关…」下拉；已在候选池里的关会自动滤掉） */
  stageOptions?: { displayCode: string; stageName: string }[];
}

/** 一条候选方案的干员列表（本关自己锁定的干员不置灰——它们是这一关要用的） */
function renderSchemeOperators(scheme: MergedScheme, hasOp: HasOp, lockedOps: LockedOps, stageCode: string): string {
  const scopedLocks: LockedOps = {};
  for (const [name, label] of Object.entries(lockedOps)) {
    if (!isLockLabelOfStage(label, stageCode)) scopedLocks[name] = label;
  }
  const items = (scheme.opers.length
    ? scheme.opers.map((oper) => ({ name: oper.name, skill: oper.skill }))
    : scheme.operators.map((name) => ({ name, skill: undefined }))
  )
    .slice(0, 8)
    .map(
      (oper) =>
        nameSpan(oper.name, hasOp, scopedLocks) +
        (oper.skill ? `<span class="dim">${oper.skill}技</span>` : ""),
    );
  return items.join("、");
}

/** 数据源标识配色：MAA=蓝、B站=粉（可被设置项关闭，回到统一蓝） */
const SOURCE_COLORS: Record<string, string> = { maa: "#0969da", bili: "#e0559b" };

/** §9.2 方案来源链接：MAA → 作业详情页；B站 → 视频页（均新标签打开） */
function renderScheme(
  scheme: MergedScheme,
  pool: MergedStagePool,
  hasOp: HasOp,
  lockedOps: LockedOps,
  picked: { key: string } | undefined,
  colorBySource: boolean,
): string {
  const key = schemeKeyOf(scheme);
  const url = schemeSourceUrl(scheme);
  // B站命中分P 时明确标注「分P12」并直链 ?p=12（实测坑：不带 ?p= 永远落在 P1）
  const isPart = scheme.source === "bili" && !!scheme.page && scheme.page > 1;
  const unit = scheme.source === "maa" ? "作业" : isPart ? `分P${scheme.page}` : "视频";
  const color = colorBySource ? SOURCE_COLORS[scheme.source] ?? "#0969da" : "#0969da";
  // 行内只留「来源 · 模式 · 干员」：标题/作者/合集放进悬浮提示（实测行太长会换行刷屏）
  const detail = [
    scheme.title ? `标题：${scheme.title}` : "",
    scheme.author ? `UP主：${scheme.author}` : "",
    scheme.collection ? `合集：${scheme.collection}${scheme.page ? `（P${scheme.page}）` : ""}` : "",
  ]
    .filter(Boolean)
    .join(" ｜ ");
  const tip = `${scheme.sourceLabel} · ${SOURCE_TIPS[scheme.source]}${detail ? `\n${detail}` : ""}`;
  const labelText = `${scheme.sourceLabel}${isPart ? ` P${scheme.page}` : ""}`;
  const label = url
    ? `<a href="${esc(url)}" target="_blank" rel="noreferrer" style="color:${color};font-weight:700" ` +
      `aria-label="${esc(`打开${unit}页：${scheme.title || scheme.stageName}`)}" ` +
      `title="${esc(`${tip}｜点击打开该${unit}页`)}">${esc(labelText)}↗</a>`
    : `<span style="color:${color};font-weight:700" title="${esc(tip)}">${esc(labelText)}</span>`;
  // 每行只留**一个链接**（来源标签本身）：原先尾部的「视频页↗/作业页↗」与它重复，两处链接容易误点
  const mode = scheme.mode ? `<b>${esc(scheme.mode)}</b> ` : "";
  // 被**别的关**占用：整条方案仍显示（干员名已置灰+删除线），并说明占用来源与后果，便于取舍
  const occupiedNote = (() => {
    const verdict = isSchemeUsable(scheme, hasOp, lockedOps, pool.displayCode);
    if (verdict.missing.length || !verdict.occupied.length) return "";
    return (
      `<div class="hint" style="margin-top:1px">⚠ ${esc(verdict.occupied.join("、"))} 已被 ` +
      `<b>${esc(verdict.occupiedFrom ?? "别的关")}</b> 占用——勾选本方案会把占用改到本关</div>`
    );
  })();
  const box =
    `<input type="checkbox" class="pickbox" data-pick="1" data-stage="${esc(pool.displayCode)}" ` +
    `data-scheme="${esc(key)}"${picked?.key === key ? " checked" : ""} ` +
    `title="勾选＝本关使用这套方案：其干员计入占用清单（同关自动换选），其它结果立即置灰；取消勾选立即恢复">`;
  return (
    `<div class="schemerow" data-pick-row="1" ` +
    `data-ops="${esc(scheme.operators.join("、"))}" ` +
    `data-search="${esc([scheme.sourceLabel, scheme.mode, scheme.title, scheme.author, scheme.operators.join("")].filter(Boolean).join(" "))}" ` +
    `style="font-size:12px;line-height:1.65;margin-top:3px;display:flex;gap:5px;align-items:baseline;cursor:pointer" ` +
    `title="${esc(tip)}">` +
    `<span style="flex:none">${box}</span>` +
    `<span style="flex:auto">${label} ${mode}${renderSchemeOperators(scheme, hasOp, lockedOps, pool.displayCode)}${occupiedNote}</span>` +
    `</div>`
  );
}

/**
 * 方案是否"可抄"：干员都在你的练度表里，且没有被**别的关**占用。
 * （"被别的关占用"= lockedOps 指向另一关；本关自己勾选的不算，见 isLockLabelOfStage）
 */
export interface SchemeUsability {
  /** 能否直接抄（不缺干员、也没被别的关占用） */
  usable: boolean;
  /** 缺哪些干员（缺的抄不了——设置项可整条隐藏） */
  missing: string[];
  /** 哪些干员已被**别的关**占用（仍展示置灰，勾选会把占用改到本关） */
  occupied: string[];
  /** 被占用的来源关卡标签（取第一个） */
  occupiedFrom?: string;
  reason?: string;
}

export function isSchemeUsable(
  scheme: MergedScheme,
  hasOp: HasOp,
  lockedOps: LockedOps,
  stageCode: string,
): SchemeUsability {
  const ops = scheme.operators.length ? scheme.operators : scheme.opers.map((o) => o.name);
  const missing = ops.filter((n) => !hasOp(n));
  const occupied = ops.filter((n) => {
    const label = lockedOps[n];
    return !!label && !isLockLabelOfStage(label, stageCode);
  });
  const occupiedFrom = occupied.length ? lockedOps[occupied[0]!] : undefined;
  const reason = missing.length
    ? `缺 ${missing.join("、")}`
    : occupied.length
      ? `已占用 ${occupied.join("、")}`
      : undefined;
  return { usable: missing.length === 0 && occupied.length === 0, missing, occupied, occupiedFrom, reason };
}

/** 分区标题（q4：结果区一眼能分出「本关阵容 / 前置关候选池」） */
function sectionHeading(text: string, sub = ""): string {
  return (
    `<div style="font-size:15px;font-weight:700;margin:14px 0 4px;padding-left:8px;border-left:4px solid #23ade5">` +
    `${esc(text)}${sub ? `<span class="dim" style="font-weight:400;font-size:12px"> ${esc(sub)}</span>` : ""}</div>`
  );
}

/**
 * 已选方案的直达链接（第十轮 q2）：勾选后候选行会折叠，标题/总览行需要能一键打开"这套攻略"。
 * 找不到对应方案、或 MAA 方案没有作业 id（只能回作业站首页）时返回 null，调用方退回关卡链接。
 */
function pickedSchemeUrl(
  pool: MergedStagePool,
  picked: { key: string } | undefined,
): { url: string; label: string } | null {
  if (!picked) return null;
  const scheme = pool.schemes.find((s) => schemeKeyOf(s) === picked.key);
  if (!scheme) return null;
  const url = schemeSourceUrl(scheme);
  if (!url || url === maaLevelUrl()) return null;
  return {
    url,
    label: `${scheme.title || scheme.stageName || pool.displayCode}（${scheme.sourceLabel}）`,
  };
}

/**
 * §10.6（q4）总览块：一屏看清三件事——
 * ① 本关（主推关）最终用哪些干员（被占用的灰+删除线）；② 各前置关选了哪套方案（或还没选）；
 * ③ 有几处替换/无解。放在结果最顶部，避免用户从长列表里自己拼。
 */
function overviewBlock(
  dispatch: boolean,
  out: AnalysisOutput,
  hasOp: HasOp,
  lockedOps: LockedOps,
  picks: DispatchPicks,
): string {
  const lineup = dispatch
    ? out.roster.slots.map((s) => s.operator)
    : out.recommendations.map((slot) => slot.finalOperator ?? slot.original.operator);
  const names = [...new Set(lineup)].filter(Boolean);
  const lineupHtml = names.length
    ? names.slice(0, 14).map((n) => nameSpan(n, hasOp, lockedOps)).join("、") +
      (names.length > 14 ? ` <span class="dim">等 ${names.length} 人</span>` : "")
    : `<span class="dim">（未识别到阵容）</span>`;
  const substituted = out.recommendations.filter((s) => s.status === "substituted").length;
  const unresolved = out.recommendations.filter((s) => s.status === "unresolved").length;

  const pools = out.dispatchGuides ?? [];
  const guideLines = pools.map((pool) => {
    const pick = picks[pool.displayCode.toUpperCase()];
    const chosen = pick
      ? `✅ ${pick.ops.map((n) => esc(n)).join("·")}`
      : `<span class="dim">⬜ 未选 → 在下方候选池勾选</span>`;
    // 已选的关：显示码本身指向**那套已选攻略**（勾选后候选行会折叠，这里是唯一的一键入口）
    const pickedLink = pickedSchemeUrl(pool, pick);
    const codeHtml = pickedLink
      ? `<a href="${esc(pickedLink.url)}" target="_blank" rel="noreferrer" style="color:#0969da;text-decoration:none" ` +
        `title="${esc(`打开已选方案：${pickedLink.label}`)}">${esc(pool.displayCode)}</a>`
      : esc(pool.displayCode);
    return (
      `<div style="font-size:12px;line-height:1.6"><b>${codeHtml}</b>` +
      `<span class="dim">（${esc(pool.stageName || "关卡名待核实")}）</span> ${chosen}</div>`
    );
  });

  return (
    `<div style="background:#f7fbfe;border:1px solid #cfe6f5;border-radius:6px;padding:8px 10px;margin:8px 0">` +
    `<div style="font-size:13px;line-height:1.7"><b>${dispatch ? "🎯 本关阵容" : "🎯 本关用这套"}（${names.length} 人）</b>：${lineupHtml}</div>` +
    (substituted || unresolved
      ? `<div class="hint">${substituted ? `已替换 ${substituted} 处` : ""}${substituted && unresolved ? "，" : ""}${unresolved ? `无解 <span class="miss">${unresolved}</span> 处` : ""}</div>`
      : "") +
    (guideLines.length
      ? `<div style="margin-top:4px;font-size:13px"><b>🚩 前置关（派遣占用）</b></div>` + guideLines.join("")
      : "") +
    `</div>`
  );
}

/**
 * 每关展示哪几条方案：**按来源配额**取（默认 MAA 3 条 + B站 3 条，总 6 条）。
 * 只按顺序截断会让 MAA 排满窗口、把 B站全挤掉（用户实测「清一色 MAA作业」的直接原因之一）；
 * 某来源不足时由另一来源补齐，`hidden` 用于提示「另有 N 条」。
 */
export function pickVisibleSchemes(
  schemes: readonly MergedScheme[],
  opts: { total?: number; perSource?: number } = {},
): { shown: MergedScheme[]; hidden: number } {
  const total = Math.max(1, opts.total ?? 6);
  const perSource = Math.max(1, opts.perSource ?? 3);
  const picked = new Set<number>();
  const used = { maa: 0, bili: 0 };
  schemes.forEach((scheme, i) => {
    if (used[scheme.source] < perSource) {
      picked.add(i);
      used[scheme.source] += 1;
    }
  });
  for (let i = 0; i < schemes.length && picked.size < total; i += 1) picked.add(i);
  const indices = [...picked].sort((a, b) => a - b).slice(0, total);
  const shown = indices.map((i) => schemes[i]!);
  return { shown, hidden: schemes.length - shown.length };
}

/** P1 黄色格识别出的派遣关攻略；每关按来源配额展示（见 pickVisibleSchemes）。 */
export function renderDispatchGuides(
  pools: NonNullable<AnalysisOutput["dispatchGuides"]>,
  hasOp: HasOp,
  lockedOps: LockedOps = {},
  opts: {
    note?: string;
    picks?: DispatchPicks;
    hideUnavailable?: boolean;
    maxRows?: number;
    colorBySource?: boolean;
    /** 大窗口页自己有卡片标题时，关掉渲染层的分区标题（避免重复） */
    showHeading?: boolean;
    /** 每关识别依据（显示码 → 「网格第 5 格（格内「催化装备」）」） */
    evidence?: Record<string, string>;
    /** 用户手动排除的关卡显示码（识别不准时改） */
    excludedStages?: string[];
    /** 本活动全部派遣关：供「＋ 补一个关…」下拉（不传则不显示纠正入口） */
    stageOptions?: { displayCode: string; stageName: string }[];
    /** 关卡链（第十一轮 q4）：依赖关 → 前置关，如 VEC-SP10 → VEC-SP09（前置关已自动纳入候选池） */
    chain?: Record<string, string>;
  } = {},
): string {
  const picks = opts.picks ?? {};
  const excluded = new Set((opts.excludedStages ?? []).map((c) => c.toUpperCase()));
  const visiblePools = pools.filter((pool) => !excluded.has(pool.displayCode.toUpperCase()));
  // 一个派遣关都没识别到时也别整段消失：只要知道本活动的派遣关清单，就留着「选择补给关…」入口兜底
  if (visiblePools.length === 0 && !opts.note && excluded.size === 0 && !(opts.stageOptions ?? []).length) {
    return "";
  }
  const maxRows = Math.max(2, opts.maxRows ?? 12);
  const colorBySource = opts.colorBySource !== false; // 默认开：MAA 蓝 / B站 粉
  const presentCodes = new Set(pools.map((p) => p.displayCode.toUpperCase()));
  const totalSchemes = visiblePools.reduce((n, pool) => n + pool.schemes.length, 0);
  const heading =
    opts.showHeading === false
      ? ""
      : sectionHeading(
          "🚩 特别战线候选池",
          `按黄色格位置识别 · ${visiblePools.length} 关 ${totalSchemes} 套（勾选＝本关采用；点整行也能勾选）`,
        );
  const blocks = visiblePools
    .map((pool: MergedStagePool) => {
      // 只隐藏**缺干员**的方案（抄不了）；被别的关占用的**保留**——干员名置灰+删除线并标注占用来源，
      // 便于跨关对比与「把占用改到本关」（用户实测：整条消失会导致没法比较，例如 A 关只有这一套）。
      const unavailable: string[] = [];
      // 被过滤掉的"缺干员"方案也留着对象：note 上给一个「点开查看」的口子（用户可能自己搜到过它们）
      const hiddenSchemes: MergedScheme[] = [];
      const candidates = opts.hideUnavailable
        ? pool.schemes.filter((scheme) => {
            const verdict = isSchemeUsable(scheme, hasOp, lockedOps, pool.displayCode);
            if (verdict.missing.length === 0) return true;
            unavailable.push(`${scheme.sourceLabel}：缺 ${verdict.missing.join("、")}`);
            hiddenSchemes.push(scheme);
            return false;
          })
        : pool.schemes;
      const { shown: schemes, hidden } = pickVisibleSchemes(candidates, {
        total: maxRows,
        perSource: Math.ceil(maxRows / 2),
      });
      const picked = picks[pool.displayCode.toUpperCase()];
      const hiddenNote = [
        hidden > 0 ? `另有 ${hidden} 条方案未展示` : "",
        unavailable.length
          ? `已隐藏 ${unavailable.length} 条缺干员的方案（${unavailable.slice(0, 2).join("；")}${unavailable.length > 2 ? "…" : ""}）` +
            ` <a href="#" data-act="show-hidden" class="link" style="font-size:11px" ` +
            `title="这些方案里有你的练度表里没有的干员（缺干员才隐藏）；点开只为看一眼，勾选仍会正常占用">点开查看</a>`
          : "",
      ]
        .filter(Boolean)
        .join("；");
      // 「点开查看」展开的内容：缺干员的方案照样按行渲染（勾选可用），只是默认折叠
      const hiddenRows = hiddenSchemes.length
        ? `<div data-hidden-schemes hidden style="margin-top:2px;padding-top:2px;border-top:1px dashed #e6e8eb">` +
          `<div class="dim" style="font-size:11px">下面这些方案缺干员（只影响显示，不影响勾选）：</div>` +
          hiddenSchemes
            .slice(0, maxRows)
            .map((scheme) => renderScheme(scheme, pool, hasOp, lockedOps, picked, colorBySource))
            .join("") +
          (hiddenSchemes.length > maxRows
            ? `<div class="dim" style="font-size:11px">另有 ${hiddenSchemes.length - maxRows} 条未列出</div>`
            : "") +
          `</div>`
        : "";
      const rows = schemes.length
        ? schemes.map((scheme) => renderScheme(scheme, pool, hasOp, lockedOps, picked, colorBySource)).join("") +
          hiddenRows +
          (hiddenNote ? `<div class="dim" style="font-size:11px;margin-top:2px">${hiddenNote}</div>` : "")
        : `<div class="dim" style="font-size:12px;margin-top:3px">` +
          (pool.schemes.length && opts.hideUnavailable
            ? `该关 ${pool.schemes.length} 套方案缺干员（${esc(unavailable.slice(0, 3).join("；"))}${unavailable.length > 3 ? "…" : ""}）`
            : "MAA / B站暂未找到公开方案") +
          `</div>`;
      // 已选好方案的关默认收起（标题行就写着选了什么），没选的关默认展开方便勾选
      const pickLine = picked
        ? `<span style="color:#1a7f37">✅ ${picked.ops.map((n) => esc(n)).join("·")}</span>`
        : `<span class="dim">⬜ 未选</span>`;
      // 第十轮 q2：已选关的标题链接直接指向**已选中的那套方案**（收起后候选行看不见，标题是唯一入口）
      const pickedLink = pickedSchemeUrl(pool, picked);
      const stageUrl = pickedLink?.url ?? maaLevelUrl();
      const stageTip = pickedLink
        ? `打开已选方案：${pickedLink.label}`
        : `在 MAA 作业站（prts.plus）看该关作业：打开后点「关卡」筛选 ${pool.displayCode}，或把显示码/通名粘进搜索框`;
      const stageMark = pickedLink ? "↗" : "";
      // 识别依据（网格第几格 / 格内名称 / 是否需核实）：让「识别错了」一眼可见
      const evidence = opts.evidence?.[pool.displayCode.toUpperCase()] ?? "";
      const evidenceLine = evidence
        ? `<div class="hint" style="margin-top:1px">识别依据：${esc(evidence)}</div>`
        : "";
      // 关卡链（第十一轮 q4）：本关需要先打谁 / 谁需要先打本关（打前置关同样占干员）
      const code = pool.displayCode.toUpperCase();
      const needFirst = opts.chain?.[code];
      const dependents = Object.entries(opts.chain ?? {})
        .filter(([, prev]) => prev === code)
        .map(([dep]) => dep);
      // 前置关可能被用户从候选池里移除了（第十五轮 q2）——那就别再说"已加入候选池"
      const needFirstInPool = !!needFirst && presentCodes.has(needFirst);
      const chainLine = needFirst
        ? `<div class="hint" style="color:#b8860b">关卡链：本关需要先打 <b>${esc(needFirst)}</b>（` +
          (needFirstInPool ? "已自动加入候选池，它的占用也要算上" : "不在候选池里，需要时可从「选择补给关…」补回来") +
          `）</div>`
        : dependents.length
          ? `<div class="hint" style="color:#b8860b">关卡链：<b>${esc(dependents.join("、"))}</b> 需要先打本关</div>`
          : "";
      return (
        `<div class="stagepool" data-stage="${esc(pool.displayCode)}" data-picked="${picked ? "1" : "0"}" ` +
        `style="padding:6px 8px;margin:4px 0;background:#fffdf6;border:1px solid #eadfbd;border-radius:5px">` +
        `<div style="font-size:12px">` +
        `<b><a href="${esc(stageUrl)}" target="_blank" rel="noreferrer" style="color:#0969da;text-decoration:none" ` +
        `title="${esc(stageTip)}">` +
        `${esc(pool.displayCode)}${stageMark}</a></b>` +
        `<span class="dim">（${esc(pool.stageName || "关卡名待核实")}）</span> ` +
        pickLine +
        `<span class="dim" style="float:right">` +
        `<span title="${esc(SOURCE_TIPS.maa)}">MAA作业 ${pool.counts.maa}</span> ｜ ` +
        `<span title="${esc(SOURCE_TIPS.bili)}">B站视频 ${pool.counts.bili}</span>` +
        (pool.counts.dup
          ? `<span class="dim" title="与 MAA 作业（或别的实战方案）阵容相同的条数——不再重复列出，避免同一套阵容刷屏">（去重 ${pool.counts.dup}）</span>`
          : "") +
        ` <a href="#" data-act="skip-stage" data-code="${esc(pool.displayCode)}" class="link" ` +
        `style="font-size:11px" title="识别错了？把这个关从本次前置关列表移除">不是这关</a>` +
        `</span></div>` +
        evidenceLine +
        chainLine +
        // 第十一轮 q2：悬浮展开只给**已选关**（它默认收起）；未选的关默认展开，不必也不该被鼠标进出开合
        (picked ? '<details data-hover="1">' : "<details open>") +
        `<summary style="font-size:11px;color:#888;cursor:pointer">候选方案 ${schemes.length} 套</summary>` +
        rows +
        `</details>` +
        `</div>`
      );
    })
    .join("");
  const noteLine = opts.note
    ? `<div class="hint" style="color:#b8860b">${esc(opts.note)}</div>`
    : "";
  // 漏识别时的补关入口：只列"当前候选池里还没出现的关"（已经在列表里的不用补；
  // 被手动「不是这关」排除的关走它自己的「恢复」链接，也不在这里重复出现）。
  // 样式走 .stage-select 类，各界面 CSS 按自己的设计上色（hover/focus 可见、200ms 过渡）。
  const addableStages = (opts.stageOptions ?? []).filter(
    (o) => !presentCodes.has(o.displayCode.toUpperCase()),
  );
  // 「选择补给关…」（第十一轮 q3 原名"按网格选关"，第十四轮按用户口径改名）：像游戏里那样按序号点选——漏好几关时比逐个下拉快得多；
  // 已在候选池里的格子禁用（避免重复查询），选中的交给 wireGridPicker → applyStageCodes。
  const stageOptions = opts.stageOptions ?? [];
  // 已在候选池的关：默认勾着（能看到当前状态），但应用时**跳过查询**、也不会重复加（第十二轮 p1）
  const inPoolCount = stageOptions.filter((o) => presentCodes.has(o.displayCode.toUpperCase())).length;
  const gridPicker = stageOptions.length
    ? `<div class="gridpicker" hidden>` +
      `<div class="gp-card" role="dialog" aria-label="选择补给关">` +
      `<div class="gp-title">特别战线 · 选择补给关` +
      `<span class="gp-sub">序号 = 从上到下、从左到右（灰格/白格也占号），与识别依据是同一套编号；` +
      `按住拖动可连续点选（滑过哪些格就选哪些）；已在候选池的关默认勾着（取消它 = 这一关识别错了，应用后会移除）</span></div>` +
      `<div class="gp-grid">` +
      stageOptions
        .map((o, i) => {
          const inPool = presentCodes.has(o.displayCode.toUpperCase());
          return (
            `<button type="button" class="gp-cell${inPool ? " in-pool on" : ""}" data-code="${esc(o.displayCode)}"` +
            (inPool ? ` data-in-pool="1"` : "") +
            ` title="${esc(`${o.displayCode} ${o.stageName}${inPool ? "（已在候选池）" : ""}`)}">` +
            `<b>${i + 1}</b><span>${esc(o.displayCode)}</span><i>${esc(o.stageName)}</i></button>`
          );
        })
        .join("") +
      `</div>` +
      `<div class="gp-foot">` +
      `<span class="gp-count dim">已选 <b>${inPoolCount}</b> 关<span class="gp-new"></span></span>` +
      `<span class="gp-actions">` +
      `<button type="button" class="stage-select" data-act="close-grid">取消</button>` +
      `<button type="button" class="stage-select gp-apply" data-act="apply-grid" disabled` +
      ` title="新勾选的关会现查并入；取消勾选的关（识别错的）会从候选池移除">应用</button>` +
      `</span></div>` +
      `</div></div>`
    : "";
  // 「选择补给关…」按钮放**区块顶部**（第十一轮 q3 用户反馈：放最底部不好点）
  const pickerBtn = stageOptions.length
    ? `<button type="button" class="stage-select" data-act="open-grid"` +
      ` title="像游戏里那样按序号点选补给关（派遣关）：点选/按住拖动连续选，再「查询并加入候选池」">选择补给关…</button>`
    : "";
  const topTools = pickerBtn
    ? `<div style="display:flex;justify-content:flex-end;gap:6px;margin:2px 0 6px">${pickerBtn}</div>`
    : "";
  const addStageLine = addableStages.length
    ? `<div class="hint" style="margin-top:6px;display:flex;align-items:center;gap:6px;flex-wrap:wrap">` +
      `<span class="dim" style="white-space:nowrap">漏识别了某一关？</span>` +
      `<select class="stage-select" data-act="add-stage" aria-label="补一个关"` +
      ` title="补一个关：现查该关的 MAA / B站 方案并加入候选池"` +
      ` style="max-width:200px"><option value="">＋ 补一个关…</option>` +
      addableStages
        .map((o) => `<option value="${esc(o.displayCode)}">${esc(o.displayCode)}（${esc(o.stageName)}）</option>`)
        .join("") +
      `</select></div>`
    : "";
  const excludedLine = excluded.size
    ? `<div class="hint">已排除（识别不准）：${[...excluded]
        .map(
          (code) =>
            `${esc(code)} <a href="#" data-act="restore-stage" data-code="${esc(code)}" class="link">恢复</a>`,
        )
        .join("、")}</div>`
    : "";
  return heading + topTools + blocks + addStageLine + gridPicker + excludedLine + noteLine;
}

/** 结果分段（大窗口页要把「本关阵容」与「前置关候选池」分栏摆放，面板/popup 则直接拼接） */
export interface ResultSections {
  intro: string; // 视频标题 / 关卡 / 类型提示 / 切换链接 / 识别说明 / 空清单引导
  overview: string; // 总览块（本关用这套 / 各前置关选了什么 / 冲突计数）
  guides: string; // 🚩 前置关候选池（含勾选）
  slots: string; // 🎯 本关适配阵容 + 未识别名提示
}

export function renderResultSections(
  out: AnalysisOutput,
  hasOp: HasOp,
  lockedOps: LockedOps = {},
  options: ResultRenderOptions = {},
): ResultSections {
  const s = out.stats;
  const stageKind = options.stageKind ?? "unknown";
  const dispatch = stageKind === "dispatch";
  const ambiguousDispatch = options.ambiguousDispatch === true;
  const statsLine = s
    ? `抓取弹幕 ${s.danmakuTotal} 条 → 候选池：评论 ${s.commentCandidates} + 弹幕 ${s.danmakuCandidates}｜`
    : "";
  const heading = dispatch ? "派遣关 · 候选方案" : "适配结果（含占用约束）";
  const stageHint = ambiguousDispatch
    ? "截图检测到多个派遣候选格：请先核对关卡编号；未唯一确定当前关前不会写入占用清单。"
    : dispatch
      ? "本关结果可加入占用清单；后续推图关会自动避开这些干员。"
      : "本关为推进关：结果已避开占用清单中的干员。";
  // 第十二轮 p4：「这其实是派遣关 → 当作派遣关」已移除——手动挑关走候选池的「选择补给关…」（第十四轮改名），
  // 同一个入口更直观，也少一个"改判定"的隐式状态
  const resolutionNote = out.stageResolution?.note
    ? `<div class="hint" style="color:#b8860b">关卡识别：${esc(out.stageResolution.note)}</div>`
    : "";
  // §9.4 空清单引导：推图关结果、占用清单为空、且下方有可勾选的派遣关方案时，
  // 告诉用户「去候选池勾一下就能立刻看到过滤效果」（无需重新分析）。
  const hasPickableGuides = (out.dispatchGuides ?? []).some((pool) => pool.schemes.length > 0);
  const emptyLocksHint =
    !dispatch && hasPickableGuides && Object.keys(lockedOps).length === 0
      ? `<div class="hint" style="background:#f3f8ff;border:1px solid #cfe3ff;border-radius:5px;padding:5px 8px;color:#0969da;margin:4px 0">` +
        `勾选任意派遣关方案后，被占用干员将在此<b>实时置灰</b>（灰色 + 删除线 + 🔒，无需重新分析）</div>`
      : "";
  const dispatchGuides = renderDispatchGuides(out.dispatchGuides ?? [], hasOp, lockedOps, {
    note: out.dispatchGuideNote,
    chain: out.dispatchStageChain,
    picks: options.picks,
    hideUnavailable: options.hideUnavailable,
    maxRows: options.maxSchemeRows,
    colorBySource: options.colorBySource,
    showHeading: options.showGuidesHeading,
    evidence: options.guideEvidence,
    excludedStages: options.excludedStages,
    stageOptions: options.stageOptions,
  });
  return {
    intro:
      `<div class="video-title">${esc(out.videoTitle)}</div>` +
      `<div class="stage">${esc(out.stage)} — ${heading}</div>` +
      `<div class="hint">${stageHint}</div>` +
      resolutionNote,
    overview: overviewBlock(dispatch, out, hasOp, lockedOps, options.picks ?? {}),
    guides: emptyLocksHint + dispatchGuides,
    slots:
      sectionHeading("🎯 本关适配阵容", `${out.recommendations.length} 个槽位`) +
      `<div class="hint">实战替代建议：${out.substitutions.length} 条｜${statsLine}名字颜色：<span class="own">绿=你有</span>／<span class="miss">红=你没有</span>${Object.keys(lockedOps).length ? "｜🔒=已派遣（灰+删除线）" : ""}</div>` +
      out.recommendations.map((s2) => renderSlot(s2, hasOp, lockedOps)).join("") +
      (s?.unknownNames && s.unknownNames.length
        ? `<div class="slot unresolved">⚠ 有 ${s.unknownNames.length} 个称呼未能识别：${s.unknownNames
            .map((n) => esc(n))
            .join("、")}<div class="note">已记入设置页「昵称纠错」——填写正确干员名并采纳后，下次分析即可识别</div></div>`
        : ""),
  };
}

export function renderResult(
  out: AnalysisOutput,
  hasOp: HasOp,
  lockedOps: LockedOps = {},
  options: ResultRenderOptions = {},
): string {
  const { intro, overview, guides, slots } = renderResultSections(out, hasOp, lockedOps, options);
  return intro + overview + guides + slots;
}

/** 占用清单区块（矢量突破类活动）：被派遣干员 chips，✕ 可移除 */
export function renderLockedSection(lockedOps: LockedOps): string {
  const entries = Object.entries(lockedOps);
  if (entries.length === 0) {
    return `<div class="hint" style="color:#999">清单为空。在派遣关候选池里勾选方案即可占用（勾选是主路径，勾完其它结果立即置灰）；也可用结果下方「加入占用清单」手动兜底。</div>`;
  }
  return entries
    .map(
      ([name, stage]) =>
        `<span class="lockchip" style="display:inline-block;background:#fdf3d8;border:1px solid #e8d48a;border-radius:12px;padding:2px 8px;margin:2px;font-size:12px">` +
        `<b>${esc(name)}</b><span class="dim"> · ${esc(stage)}</span>` +
        `<span class="rmlock" data-name="${esc(name)}" title="移除" style="cursor:pointer;color:#c0392b;margin-left:4px">✕</span></span>`,
    )
    .join("");
}
