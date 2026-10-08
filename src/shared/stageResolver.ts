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

/** 文本中出现 MAA 关卡通名时反查关卡；优先较新活动。 */
export function matchRegisteredName(text: string, levels: readonly MaaLevel[]): MaaLevel | undefined {
  const normalized = normalizeText(text);
  if (!normalized) return undefined;
  return [...levels]
    .filter((l) => l.name.length >= 2 && normalized.includes(l.name))
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
): StageResolution {
  const text = [stage, videoTitle, extraText].filter(Boolean).join("\n");
  const code = extractDisplayCode(text);
  if (code) {
    const level = exactLevelByCode(levels, code);
    return level
      ? resolutionFromLevel(level, "text_code")
      : { source: "text_code", displayCode: code };
  }

  const named = matchRegisteredName(text, levels);
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
function collectDispatchGridHints(vision: StageVisionHints): NormalizedGridHint[] {
  const cells = collectGridCellHints(vision);
  if (cells.length > 0) return cells;
  const position = normalizeGridPosition(vision);
  if (!position) return [];
  return [{
    position,
    row: Number(vision.gridRow) || undefined,
    column: Number(vision.gridColumn) || undefined,
    name: sanitizeStageName(vision.gridName) || undefined,
  }];
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
  crossCheck?: { byName?: boolean; positionLevel?: MaaLevel },
): StageGridCandidate {
  const nameMismatch =
    !!hint.name && normalizeName(hint.name) !== normalizeName(level.name);
  // 名称优先时若位置推算指向另一关，标记待核实（note 由调用方拼接）
  const positionConflict =
    !!crossCheck?.byName &&
    !!crossCheck.positionLevel &&
    crossCheck.positionLevel.displayCode !== level.displayCode;
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
function mapHintToLevel(
  hint: NormalizedGridHint,
  stages: readonly MaaLevel[],
): { level: MaaLevel; byName: boolean; positionLevel?: MaaLevel } | null {
  const byPosition = codeFromGridPosition(hint.position, stages);
  if (hint.name) {
    const wanted = normalizeName(hint.name);
    const byName = stages.find((s) => normalizeName(s.name) === wanted);
    if (byName) return { level: byName, byName: true, positionLevel: byPosition ?? undefined };
  }
  return byPosition ? { level: byPosition, byName: false } : null;
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
  if (hints.length === 0) return { candidates: [], invalidPositions: [] };

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
  // 全部格都读到名称、却没有一个能在本活动关卡库里匹配 → 多半是补给/配置界面
  // （实测黄格内是「催化装备」这类补给名）：不按位置硬猜关卡，避免污染候选池。
  const namedHints = hints.filter((h) => !!h.name);
  const anyNameMatched = hints.some((h) => mapHintToLevel(h, stages)?.byName);
  if (namedHints.length > 0 && namedHints.length === hints.length && !anyNameMatched) {
    return {
      candidates: [],
      invalidPositions: [],
      prefix,
      note:
        `P1 网格内读到的名称（${namedHints.map((h) => h.name).join("、")}）不属于本活动任何关卡，` +
        `可能是补给/配置界面：本次未按网格位置推算派遣关（避免识别错误）`,
    };
  }
  const mismatchNotes: string[] = [];
  for (const hint of hints) {
    const mapped = mapHintToLevel(hint, stages);
    if (!mapped) {
      invalidPositions.push(hint.position);
      continue;
    }
    candidates.push(
      candidateFromLevel(hint, mapped.level, {
        byName: mapped.byName,
        positionLevel: mapped.positionLevel,
      }),
    );
    if (mapped.byName && mapped.positionLevel && mapped.positionLevel.displayCode !== mapped.level.displayCode) {
      mismatchNotes.push(
        `P1 格内名称“${hint.name}”与网格位置推算的 ${mapped.positionLevel.displayCode}（${mapped.positionLevel.name}）不一致，已按名称采用 ${mapped.level.displayCode}`,
      );
    } else if (!mapped.byName && hint.name) {
      mismatchNotes.push(`P1 通名“${hint.name}”不在关卡库中，已按网格位置采用 ${mapped.level.displayCode}`);
    }
  }
  const invalidNote = invalidPositions.length
    ? `P1 网格位置 ${invalidPositions.join("、")} 超出该活动的派遣关范围`
    : "";

  return {
    candidates,
    invalidPositions,
    prefix,
    note: [...mismatchNotes, invalidNote].filter(Boolean).join("；") || undefined,
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
): StageResolution {
  const textResolution = resolveStageFromText(stage, videoTitle, extraText, levels);
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
        positionLevel: mapped.positionLevel,
      }),
    );
    if (mapped.byName && mapped.positionLevel && mapped.positionLevel.displayCode !== mapped.level.displayCode) {
      gridNotes.push(
        `格内名称“${hint.name}”与网格位置推算的 ${mapped.positionLevel.displayCode}（${mapped.positionLevel.name}）不一致，已按名称采用 ${mapped.level.displayCode}`,
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
): Promise<{
  resolution: StageResolution;
  displayStage: string;
  dispatchCandidates: StageGridCandidate[];
  dispatchGridNote?: string;
}> {
  const levels = await getLevelDb().catch(() => []);
  const resolution = resolveStageWithVision(stage, videoTitle, extraText, vision, levels);
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
