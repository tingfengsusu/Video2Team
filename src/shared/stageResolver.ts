/**
 * 派遣关编号解析：
 * 1. 标题/分P/简介/画面中的显式 VEC-SPxx
 * 2. MAA 关卡库中文通名反查
 * 3. 特别战线截图的网格阅读顺序位置（从上到下、从左到右）
 *
 * 网格位置与格内通名冲突时以位置为准，并保留核实提示。
 */

import {
  eventPrefixFromStageId,
  getLevelDb,
  listDispatchStagesFromLevels,
  type MaaLevel,
} from "./maa";
import type {
  StageGridCandidate,
  StageGridCellHint,
  StageResolution,
  StageVisionHints,
} from "./types";

function normalizeText(text: string): string {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCode(text: string): string {
  return String(text ?? "").toUpperCase().replace(/[\s_–—]+/g, "-");
}

function normalizeName(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[\s·・:：,，.。/\\()[\]【】<>《》_-]+/g, "");
}

/**
 * §9.6 界面标题/栏目名等「不是关卡名」的文案：OCR 易把页面标题当成格内通名
 * （实测「特别战线」被当成通名 → 误报「通名与位置推算不一致」）。
 * 命中即视为没读到通名（留空），位置规则正常生效、不再误报冲突。
 */
const UI_TEXT_PATTERNS: RegExp[] = [
  /特别战线/,
  /矢量突破/,
  /核心突破/,
  /选择关卡/,
  /请选择/,
  /^关卡/,
  /^作战$/,
  /^活动关卡$/,
  /^主线/,
  /^派遣/,
  /^驻防/,
];
// 已按 MAA 关卡库（2367 个关卡名）核对：以上模式不命中任何真实关卡名
// （曾考虑 /^集火/，但存在真实关卡「集火-1」，故不纳入）。

function sanitizeStageName(raw: string | undefined): string {
  const name = normalizeText(raw ?? "");
  if (!name) return "";
  return UI_TEXT_PATTERNS.some((re) => re.test(name)) ? "" : name;
}

function activityRank(stageId: string): number {
  const m = /^act(\d+)/i.exec(stageId);
  return m ? Number(m[1]) || 0 : 0;
}

function newerLevel(a: MaaLevel, b: MaaLevel): number {
  return activityRank(b.stageId) - activityRank(a.stageId) || b.displayCode.localeCompare(a.displayCode, "en", { numeric: true });
}

function exactLevelByCode(levels: readonly MaaLevel[], code: string): MaaLevel | undefined {
  const wanted = normalizeCode(code);
  return [...levels]
    .filter((l) => normalizeCode(l.displayCode) === wanted)
    .sort(newerLevel)[0];
}

function exactLevelByName(levels: readonly MaaLevel[], name: string): MaaLevel | undefined {
  const wanted = normalizeName(name);
  if (!wanted) return undefined;
  return [...levels]
    .filter((l) => normalizeName(l.name) === wanted)
    .sort(newerLevel)[0];
}

/** 从自由文本提取任意已登记形态的显示码，例如 VEC-C / VEC-SP07。 */
export function extractDisplayCode(text: string): string | null {
  const m = String(text ?? "").match(
    /VEC[\s_-]*(SP[\s_-]*\d{1,2}|[A-D](?:[\s_-]*\d{1,2})?)/i,
  );
  if (!m?.[1]) return null;
  const suffix = m[1].toUpperCase().replace(/[\s_-]+/g, "");
  return `VEC-${suffix}`;
}

/** 从自由文本提取并规范 VEC-SPxx；无显式码返回 null。 */
export function extractDispatchCode(text: string): string | null {
  const code = extractDisplayCode(text);
  const m = code?.match(/^VEC-SP(\d{1,2})$/);
  if (!m?.[1]) return null;
  return `VEC-SP${String(Number(m[1])).padStart(2, "0")}`;
}

/** 在文本中找已在关卡库登记的显示码（包括 VEC-C 等推图关，用于推断活动前缀）。 */
export function matchRegisteredCode(text: string, levels: readonly MaaLevel[]): MaaLevel | undefined {
  const normalized = normalizeCode(text);
  return [...levels]
    .filter((l) => normalized.includes(normalizeCode(l.displayCode)))
    .sort(newerLevel)[0];
}

/** 通名匹配的可选护栏（见 matchRegisteredName / resolveStageFromText） */
export interface NameMatchOptions {
  /**
   * 这个名字是否"像干员名"（字典里有它，或它是某个干员名的子串）。
   * 实测坑（第十二轮）：关卡「0-9」的通名是「临光」，而「临光」既是干员名、又是「耀骑士临光」的子串——
   * 攻略简介/评论里一提到干员，整关就被解析成「0-9（临光）」。
   */
  isOperatorLike?: (name: string) => boolean;
}

/** 文本中出现 MAA 关卡通名时反查关卡；优先较新活动。
 *  opts.isOperatorLike 命中且命中的是**简介/评论**这类弱文本时，调用方应把它当噪声跳过。 */
export function matchRegisteredName(
  text: string,
  levels: readonly MaaLevel[],
  opts: NameMatchOptions = {},
): MaaLevel | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  const skip = opts.isOperatorLike;
  return [...levels]
    .filter((l) => l.name.length >= 2 && normalized.includes(l.name) && !(skip && skip(l.name)))
    .sort((a, b) => newerLevel(a, b) || b.name.length - a.name.length)[0];
}

/** 推断当前活动内部前缀；优先显式码/通名，最后在“矢量突破”活动族中取最新一期。 */
export function inferEventPrefix(text: string, levels: readonly MaaLevel[]): string {
  const byCode = matchRegisteredCode(text, levels);
  if (byCode) return eventPrefixFromStageId(byCode.stageId);
  const byName = matchRegisteredName(text, levels);
  if (byName) return eventPrefixFromStageId(byName.stageId);
  if (!/矢量突破|特别战线/i.test(text)) return "";

  const latest = [...levels]
    .filter((l) => /矢量突破|特别战线/i.test(l.eventName))
    .sort(newerLevel)[0];
  return latest ? eventPrefixFromStageId(latest.stageId) : "";
}

function resolutionFromLevel(level: MaaLevel, source: StageResolution["source"]): StageResolution {
  return {
    source,
    displayCode: level.displayCode,
    stageId: level.stageId,
    stageName: level.name,
  };
}

/** 只使用文本材料解析；失败返回 source=unknown，由截图网格或人工兜底。 */
export function resolveStageFromText(
  stage: string,
  videoTitle: string,
  extraText: string,
  levels: readonly MaaLevel[],
  opts: NameMatchOptions = {},
): StageResolution {
  const text = [stage, videoTitle, extraText].filter(Boolean).join("\n");
  const code = extractDisplayCode(text);
  if (code) {
    const level = exactLevelByCode(levels, code);
    return level
      ? resolutionFromLevel(level, "text_code")
      : { source: "text_code", displayCode: code };
  }

  // 通名匹配：标题（分P标题/视频标题）里出现就算数；**简介/评论**里的命中要排除"像干员名"的关卡名，
  // 否则攻略简介里的干员列表会把关卡解析带跑（实测：「0-9（临光）」）
  const titleText = [stage, videoTitle].filter(Boolean).join("\n");
  const named =
    matchRegisteredName(titleText, levels) ?? matchRegisteredName(text, levels, opts);
  if (named) return resolutionFromLevel(named, "level_name");
  return { source: "unknown" };
}

/** 网格阅读顺序位置 → 关卡库里的派遣关显示码。 */
export function codeFromGridPosition(
  position: number,
  stages: readonly MaaLevel[],
): MaaLevel | null {
  const p = Math.trunc(position);
  if (p < 1 || p > stages.length) return null;
  return stages[p - 1] ?? null;
}

function normalizeGridPosition(vision: StageVisionHints): number | undefined {
  const byRowColumn = positionFromRowColumn(vision.gridRow, vision.gridColumn, vision.gridColumns);
  if (byRowColumn) return byRowColumn;
  const direct = Number(vision.gridPosition);
  return Number.isInteger(direct) && direct > 0 ? direct : undefined;
}

function positionFromRowColumn(
  rawRow: unknown,
  rawColumn: unknown,
  rawColumns: unknown,
): number | undefined {
  const row = Number(rawRow);
  const column = Number(rawColumn);
  const columns = Number(rawColumns);
  if (Number.isInteger(row) && row > 0 && Number.isInteger(column) && column > 0 && Number.isInteger(columns) && columns > 0) {
    return (row - 1) * columns + column;
  }
  return undefined;
}

interface NormalizedGridHint {
  position: number;
  row?: number;
  column?: number;
  name?: string;
}

function normalizeGridCell(
  cell: StageGridCellHint,
  fallbackColumns?: number,
): NormalizedGridHint | null {
  const row = Number(cell.row);
  const column = Number(cell.column);
  const columns = Number(cell.columns) || Number(fallbackColumns);
  const direct = Number(cell.position);
  const byRowColumn = positionFromRowColumn(row, column, columns);
  const position =
    byRowColumn ??
    (Number.isInteger(direct) && direct > 0 ? Math.trunc(direct) : undefined);
  if (!position) return null;
  return {
    position,
    row: Number.isInteger(row) && row > 0 ? row : undefined,
    column: Number.isInteger(column) && column > 0 ? column : undefined,
    name: sanitizeStageName(cell.name) || undefined,
  };
}

/** 只收集 P1 的黄色格列表，按阅读顺序去重。 */
function collectGridCellHints(vision: StageVisionHints): NormalizedGridHint[] {
  const hints: NormalizedGridHint[] = [];
  for (const cell of vision.gridCells ?? []) {
    const normalized = normalizeGridCell(cell, vision.gridColumns);
    if (normalized) hints.push(normalized);
  }

  const deduped = new Map<number, NormalizedGridHint>();
  for (const hint of hints) {
    const previous = deduped.get(hint.position);
    deduped.set(hint.position, {
      position: hint.position,
      row: hint.row ?? previous?.row,
      column: hint.column ?? previous?.column,
      name: hint.name ?? previous?.name,
    });
  }
  return [...deduped.values()].sort((a, b) => a.position - b.position);
}

/** P1 攻略查询优先用全部黄色格；旧版输出没有列表时退回单格位置。 */
/**
 * 从模型说明（note）里解析格位（第十四轮 q1）。
 *
 * 实测：模型会把「4行4列，高亮格=第2行第1、2、3格，第3行第2、3、4格，共6格」写在 note 里，
 * 却因为"格内是图标/文字认不出名称"把 gridCells 整组留空——但**格位本来就够用**
 * （插件只按序号定位关卡），所以这里兜底把它转成格位。
 *
 * 只认「第N行 … 第a、b、c格」与「第a、b、c格」（直接给序号）两种写法；解析不出返回空（宁缺勿错）。
 */
export function parseGridCellsFromNote(note: string, columnsFallback?: number): StageGridCellHint[] {
  const text = String(note ?? "").replace(/[\s　]+/g, "");
  if (!text) return [];
  const dim = text.match(/(\d{1,2})行(\d{1,2})列/);
  const columns = (dim ? Number(dim[2]) : 0) || Math.trunc(Number(columnsFallback) || 0) || 0;
  const cells: StageGridCellHint[] = [];
  const push = (row: number | undefined, column: number | undefined, position?: number): void => {
    if (!position && !(row && column)) return;
    cells.push({
      position: position ?? (row && column && columns ? (row - 1) * columns + column : 0),
      row,
      column,
      columns: columns || undefined,
      name: "",
    });
  };
  const rowMarks = [...text.matchAll(/第(\d{1,2})行/g)];
  if (rowMarks.length) {
    for (let i = 0; i < rowMarks.length; i += 1) {
      const row = Number(rowMarks[i]![1]);
      const from = rowMarks[i]!.index ?? 0;
      const to = i + 1 < rowMarks.length ? (rowMarks[i + 1]!.index ?? text.length) : text.length;
      const seg = text.slice(from, to);
      // 「第a、b、c格」——必须有「第」字在前，"共6格"这类计数不会被当成列号
      for (const m of seg.matchAll(/第((?:\d{1,2}[、,，]*)+\d{1,2})格/g)) {
        for (const n of m[1]!.split(/[、,，]/).map(Number)) {
          if (n >= 1 && n <= 99) push(row, n, columns ? (row - 1) * columns + n : undefined);
        }
      }
    }
    return cells.filter((c) => (c.position ?? 0) > 0);
  }
  // 没有「第N行」：看是不是直接给了序号列表（「第5、6、7格」/「格位 5、6、7」）
  const listMatch = text.match(/(?:格位|序号|position[:：]?|第)((?:\d{1,2}[、,，])+\d{1,2})格/);
  if (listMatch?.[1]) {
    for (const n of [...new Set(listMatch[1].split(/[、,，]/).map(Number))]) {
      if (n >= 1 && n <= 99) push(undefined, undefined, n);
    }
  }
  return cells.filter((c) => (c.position ?? 0) > 0);
}

/** 网格总列数：模型给的总列数优先，其次按特别战线常见布局取 4 */
function gridColumnsOf(vision: StageVisionHints | undefined): number {
  const c = Number(vision?.gridColumnsTotal) || Number(vision?.gridColumns);
  return Number.isInteger(c) && c > 0 ? c : 4;
}

function collectDispatchGridHints(vision: StageVisionHints): NormalizedGridHint[] {
  const cells = collectGridCellHints(vision);
  if (cells.length > 0) return cells;
  const position = normalizeGridPosition(vision);
  if (position) {
    return [{
      position,
      row: Number(vision.gridRow) || undefined,
      column: Number(vision.gridColumn) || undefined,
      name: sanitizeStageName(vision.gridName) || undefined,
    }];
  }
  // 第十四轮 q1：模型把格位写在了 note 里 → 解析成格位（它们本来就够定位关卡）
  const columns = gridColumnsOf(vision);
  return parseGridCellsFromNote(vision.note ?? "", columns)
    .map((cell) => normalizeGridCell(cell, columns))
    .filter((hint): hint is NormalizedGridHint => !!hint)
    .sort((a, b) => a.position - b.position);
}

function collectCurrentGridHints(vision: StageVisionHints): NormalizedGridHint[] {
  const position = normalizeGridPosition(vision);
  if (position) {
    return [{
      position,
      row: Number(vision.gridRow) || undefined,
      column: Number(vision.gridColumn) || undefined,
      name: sanitizeStageName(vision.gridName) || undefined,
    }];
  }
  return collectGridCellHints(vision);
}

function candidateFromLevel(
  hint: NormalizedGridHint,
  level: MaaLevel,
  crossCheck?: { byName?: boolean; nameLevel?: MaaLevel },
): StageGridCandidate {
  const nameMismatch =
    !!hint.name && normalizeName(hint.name) !== normalizeName(level.name);
  // 名称优先时若位置推算指向另一关，标记待核实（note 由调用方拼接）
  const positionConflict =
    !!crossCheck?.byName &&
    !!crossCheck.nameLevel && crossCheck.nameLevel.displayCode !== level.displayCode;
  return {
    gridPosition: hint.position,
    gridRow: hint.row,
    gridColumn: hint.column,
    gridName: hint.name,
    displayCode: level.displayCode,
    stageId: level.stageId,
    stageName: level.name,
    needsVerification: nameMismatch || positionConflict || undefined,
  };
}

/**
 * 把一格网格提示映射到关卡。
 *
 * v4.3 二次实测（q3 反馈）：模型的行列读数并不可靠（实测把 r2c1/r2c3/r3c4 报成 10/11/16），
 * 因此**格内名称优先**：名称能在本活动派遣关列表里精确匹配就用它，位置推算降级为交叉校验
 * （不一致时保留核实提示）；名称缺失或不在库中才回退位置规则。
 */
/**
 * 把一格网格提示映射到关卡：**序号（位置）为准**。
 *
 * 用户实测取捨（2026-10-09）：黄格里的文字是**补给名**（催化装备/缴械装备…），不在关卡库里，
 * 对定位意义不大；真正可靠的是「从上到下、从左到右」的**序号**。故位置优先，
 * 文字仅在与关卡库对上时做交叉校验（不一致给提示，不覆盖位置结论），位置越界时才退回文字。
 */
function mapHintToLevel(
  hint: NormalizedGridHint,
  stages: readonly MaaLevel[],
): { level: MaaLevel; byName: boolean; nameLevel?: MaaLevel } | null {
  const byPosition = codeFromGridPosition(hint.position, stages);
  const hintName = hint.name ?? "";
  const nameLevel = hintName
    ? stages.find((s) => normalizeName(s.name) === normalizeName(hintName))
    : undefined;
  if (byPosition) return { level: byPosition, byName: false, nameLevel };
  if (nameLevel) return { level: nameLevel, byName: true };
  return null;
}

function resolutionFromGridCandidate(
  candidate: StageGridCandidate,
  note?: string,
): StageResolution {
  return {
    source: "grid",
    displayCode: candidate.displayCode,
    stageId: candidate.stageId,
    stageName: candidate.stageName,
    gridPosition: candidate.gridPosition,
    gridName: candidate.gridName,
    gridCandidates: [candidate],
    needsVerification: candidate.needsVerification,
    note,
  };
}

export interface DispatchGridResolution {
  candidates: StageGridCandidate[];
  invalidPositions: number[];
  prefix?: string;
  note?: string;
}

/**
 * 独立解析 P1 特别战线选择界面的黄色格。
 *
 * 该结果不能与“当前关”互相覆盖：P1 可以同时有多个黄色派遣格，
 * 而 P2 仍可能明确写着 VEC-C 这种推进关。
 */
export function resolveDispatchGridFromVision(
  stage: string,
  videoTitle: string,
  extraText: string,
  vision: StageVisionHints | undefined,
  levels: readonly MaaLevel[],
): DispatchGridResolution {
  const hints = vision ? collectDispatchGridHints(vision) : [];
  if (hints.length === 0) {
    // 第十轮 q4 实测：模型明明数出了「4×4 网格、6 个启用格」，却因为"格内文字看不清/没确认全名称"
    // 把 gridCells 整组留空。静默返回会让人以为"这关本来就不是派遣关"——这里给出可见原因、
    // 模型原话（便于判断是截图问题还是模型问题）与下一步（重截图 / 手动补关）。
    const enabled = Number(vision?.enabledSupplies);
    const rows = Number(vision?.gridRows);
    const cols = Number(vision?.gridColumnsTotal);
    const hasEnabled = Number.isInteger(enabled) && enabled > 0;
    const hasShape = Number.isInteger(rows) && rows > 0 && Number.isInteger(cols) && cols > 0;
    const note =
      hasEnabled || hasShape
        ? [
            `这张图像是特别战线/补给网格${hasShape ? `（${rows}×${cols}）` : ""}` +
              `${hasEnabled ? `，画面里「当前启用补给」显示 ${enabled} 个` : ""}，但没有给出**格位**——本次未识别出派遣关。` +
              `插件只按格位序号定位关卡，格内文字是补给名、只作交叉校验，所以文字读不清时也应逐格给出 position（或 row+column）；` +
              `可重新截图（让整个网格清楚可见），或用结果区「＋ 补一个关…」手动补`,
            vision?.note ? `模型说明：${vision.note}` : "",
          ]
            .filter(Boolean)
            .join("；")
        : undefined;
    return { candidates: [], invalidPositions: [], note };
  }

  const context = [
    stage,
    videoTitle,
    extraText,
    vision?.explicitCode,
    vision?.matchedName,
    vision?.gridName,
  ]
    .filter(Boolean)
    .join("\n");
  const prefix = inferEventPrefix(context, levels);
  const stages = prefix ? listDispatchStagesFromLevels(levels, prefix) : [];
  if (!prefix || stages.length === 0) {
    return {
      candidates: [],
      invalidPositions: [],
      note: "P1 截图像是特别战线网格，但未能确定所属活动，未自动查询派遣关攻略",
    };
  }

  const candidates: StageGridCandidate[] = [];
  const invalidPositions: number[] = [];
  const mismatchNotes: string[] = [];
  // 格位是从模型说明（note）里解析出来的 → 明确告诉用户来源，别让人以为模型真的填了 gridCells
  const fromNote =
    hints.length > 0 && collectGridCellHints(vision!).length === 0 && !normalizeGridPosition(vision!)
      ? "格位来自模型说明的文本解析（它把行列写在了 note 里，未填 gridCells）"
      : "";
  for (const hint of hints) {
    const mapped = mapHintToLevel(hint, stages);
    if (!mapped) {
      invalidPositions.push(hint.position);
      continue;
    }
    candidates.push(
      candidateFromLevel(hint, mapped.level, {
        byName: mapped.byName,
        nameLevel: mapped.nameLevel,
      }),
    );
    if (mapped.byName) {
      mismatchNotes.push(
        `网格第 ${hint.position} 格超出派遣关范围，已按格内文字“${hint.name}”采用 ${mapped.level.displayCode}`,
      );
    } else if (mapped.nameLevel && mapped.nameLevel.displayCode !== mapped.level.displayCode) {
      mismatchNotes.push(
        `网格第 ${hint.position} 格的文字“${hint.name}”对应 ${mapped.nameLevel.displayCode}（${mapped.nameLevel.name}），` +
          `与序号推算的 ${mapped.level.displayCode} 不一致，已按序号采用，请核实`,
      );
    }
  }
  const invalidNote = invalidPositions.length
    ? `网格位置 ${invalidPositions.join("、")} 超出该活动的派遣关范围`
    : "";
  // 自检对账：画面「当前启用补给 N/M」的 N 应与黄格数量一致（实测模型会漏格/读错序号）
  const enabled = Number(vision?.enabledSupplies);
  const countNote =
    Number.isInteger(enabled) && enabled > 0 && enabled !== hints.length && hints.length > 0
      ? `画面「当前启用补给」显示 ${enabled} 个，网格里识别到 ${hints.length} 个黄格——可能有遗漏或错位，请用结果区「＋ 补一个关…」核对`
      : "";

  return {
    candidates,
    invalidPositions,
    prefix,
    note: [fromNote, ...mismatchNotes, countNote, invalidNote].filter(Boolean).join("；") || undefined,
  };
}

/**
 * 综合文本与画面提示。文本显式码最高优先，其次关卡库通名，最后网格位置。
 * 网格格内名称与位置推算不一致时，**名称优先**（位置读数实测不可靠）并标记 needsVerification；
 * 名称全都不在关卡库时视为非关卡网格，不给候选（见 resolveDispatchGridFromVision）。
 */
export function resolveStageWithVision(
  stage: string,
  videoTitle: string,
  extraText: string,
  vision: StageVisionHints | undefined,
  levels: readonly MaaLevel[],
  opts: NameMatchOptions = {},
): StageResolution {
  const textResolution = resolveStageFromText(stage, videoTitle, extraText, levels, opts);
  if (textResolution.source !== "unknown") return textResolution;

  const hintedCode = extractDisplayCode(vision?.explicitCode ?? "");
  if (hintedCode) {
    const level = exactLevelByCode(levels, hintedCode);
    return level
      ? resolutionFromLevel(level, "text_code")
      : { source: "text_code", displayCode: hintedCode };
  }

  const hintedName = sanitizeStageName(vision?.matchedName);
  if (hintedName) {
    const level = exactLevelByName(levels, hintedName);
    if (level) return resolutionFromLevel(level, "level_name");
  }

  const position = vision ? normalizeGridPosition(vision) : undefined;
  const currentHints = vision ? collectCurrentGridHints(vision) : [];
  if (currentHints.length === 0) {
    return {
      source: "unknown",
      gridPosition: position,
      gridName: sanitizeStageName(vision?.gridName) || undefined,
      note: "截图像是特别战线网格，但未能确定所属活动，请核实关卡编号",
    };
  }

  const context = [
    stage,
    videoTitle,
    extraText,
    vision?.explicitCode,
    vision?.matchedName,
    vision?.gridName,
  ]
    .filter(Boolean)
    .join("\n");
  const prefix = inferEventPrefix(context, levels);
  const stages = prefix ? listDispatchStagesFromLevels(levels, prefix) : [];
  if (!prefix || stages.length === 0) {
    return {
      source: "unknown",
      gridPosition: position,
      gridName: sanitizeStageName(vision?.gridName) || undefined,
      note: "截图像是特别战线网格，但未能确定所属活动，请核实关卡编号",
    };
  }

  const candidates: StageGridCandidate[] = [];
  const invalidPositions: number[] = [];
  const gridNotes: string[] = [];
  for (const hint of currentHints) {
    const mapped = mapHintToLevel(hint, stages);
    if (!mapped) {
      invalidPositions.push(hint.position);
      continue;
    }
    candidates.push(
      candidateFromLevel(hint, mapped.level, {
        byName: mapped.byName,
        nameLevel: mapped.nameLevel,
      }),
    );
    if (mapped.byName) {
      gridNotes.push(`网格第 ${hint.position} 格超出派遣关范围，已按格内文字“${hint.name}”采用 ${mapped.level.displayCode}`);
    } else if (mapped.nameLevel && mapped.nameLevel.displayCode !== mapped.level.displayCode) {
      gridNotes.push(
        `网格第 ${hint.position} 格的文字“${hint.name}”对应 ${mapped.nameLevel.displayCode}（${mapped.nameLevel.name}），` +
          `与序号推算的 ${mapped.level.displayCode} 不一致，已按序号采用，请核实`,
      );
    }
  }

  if (candidates.length === 0) {
    return {
      source: "grid",
      gridPosition: position ?? invalidPositions[0],
      gridName: sanitizeStageName(vision?.gridName) || undefined,
      needsVerification: true,
      note: `截图网格位置 ${invalidPositions.join("、")} 超出该活动的派遣关范围，请核实`,
    };
  }

  const mismatchNotes = gridNotes.length ? gridNotes : [];
  const invalidNote = invalidPositions.length
    ? `网格位置 ${invalidPositions.join("、")} 超出该活动的派遣关范围`
    : "";
  const baseNote = [vision?.note, ...mismatchNotes, invalidNote].filter(Boolean).join("；");

  if (candidates.length === 1) {
    const candidate = candidates[0]!;
    const note =
      [baseNote, candidate.needsVerification ? "请核实" : ""].filter(Boolean).join("；") ||
      undefined;
    return resolutionFromGridCandidate(candidate, note);
  }

  const candidateText = candidates
    .map((candidate) => `${candidate.gridPosition}=${candidate.displayCode}（${candidate.stageName}）`)
    .join("、");
  return {
    source: "unknown",
    gridPosition: candidates[0]?.gridPosition,
    gridCandidates: candidates,
    needsVerification: true,
    note: [
      baseNote,
      `截图检测到多个黄色格：${candidateText}；标题/画面无法唯一定位当前关，请核实`,
    ]
      .filter(Boolean)
      .join("；"),
  };
}

export function formatStageResolution(resolution: StageResolution, fallback: string): string {
  if (!resolution.displayCode) return fallback;
  return resolution.stageName
    ? `${resolution.displayCode}（${resolution.stageName}）`
    : resolution.displayCode;
}

/** 后台主流程用：解析后只改 stage 展示名，不动分P/cid。 */
export async function resolveStageForAnalysis(
  stage: string,
  videoTitle: string,
  extraText: string,
  vision?: StageVisionHints,
  opts: NameMatchOptions = {},
): Promise<{
  resolution: StageResolution;
  displayStage: string;
  dispatchCandidates: StageGridCandidate[];
  dispatchGridNote?: string;
}> {
  const levels = await getLevelDb().catch(() => []);
  const resolution = resolveStageWithVision(stage, videoTitle, extraText, vision, levels, opts);
  const grid = resolveDispatchGridFromVision(
    stage,
    videoTitle,
    extraText,
    vision,
    levels,
  );
  const dispatchCandidates = [...grid.candidates];
  if (
    dispatchCandidates.length === 0 &&
    /^VEC-SP\d{1,2}$/i.test(resolution.displayCode ?? "") &&
    resolution.stageId &&
    resolution.stageName
  ) {
    dispatchCandidates.push({
      gridPosition: resolution.gridPosition ?? 0,
      gridName: resolution.gridName,
      displayCode: resolution.displayCode!,
      stageId: resolution.stageId,
      stageName: resolution.stageName,
      needsVerification: resolution.needsVerification,
    });
  }
  return {
    resolution,
    displayStage: formatStageResolution(resolution, stage),
    dispatchCandidates,
    dispatchGridNote: grid.note,
  };
}
