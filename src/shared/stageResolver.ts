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

function dispatchLevels(levels: readonly MaaLevel[]): MaaLevel[] {
  return levels.filter((l) => /_sp\d+$/i.test(l.stageId));
}

/** 从自由文本提取并规范 VEC-SPxx；无显式码返回 null。 */
export function extractDispatchCode(text: string): string | null {
  const m = String(text ?? "").match(/VEC[\s_-]*SP[\s_-]*(\d{1,2})/i);
  if (!m) return null;
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
  const code = extractDispatchCode(text);
  if (code) {
    const level = exactLevelByCode(levels, code);
    return level
      ? resolutionFromLevel(level, "text_code")
      : { source: "text_code", displayCode: code };
  }

  const named = matchRegisteredName(text, dispatchLevels(levels));
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
  const direct = Number(vision.gridPosition);
  if (Number.isInteger(direct) && direct > 0) return direct;
  return positionFromRowColumn(vision.gridRow, vision.gridColumn, vision.gridColumns);
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
  const position =
    Number.isInteger(Number(cell.position)) && Number(cell.position) > 0
      ? Math.trunc(Number(cell.position))
      : positionFromRowColumn(row, column, columns);
  if (!position) return null;
  return {
    position,
    row: Number.isInteger(row) && row > 0 ? row : undefined,
    column: Number.isInteger(column) && column > 0 ? column : undefined,
    name: normalizeText(cell.name ?? "") || undefined,
  };
}

/** 合并新版 gridCells 与旧版单格字段，按阅读顺序去重。 */
function collectGridHints(vision: StageVisionHints): NormalizedGridHint[] {
  const singlePosition = normalizeGridPosition(vision);
  if (singlePosition) {
    return [{
      position: singlePosition,
      row: Number(vision.gridRow) || undefined,
      column: Number(vision.gridColumn) || undefined,
      name: normalizeText(vision.gridName ?? "") || undefined,
    }];
  }

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

function candidateFromLevel(
  hint: NormalizedGridHint,
  level: MaaLevel,
): StageGridCandidate {
  const nameMismatch =
    !!hint.name && normalizeName(hint.name) !== normalizeName(level.name);
  return {
    gridPosition: hint.position,
    gridRow: hint.row,
    gridColumn: hint.column,
    gridName: hint.name,
    displayCode: level.displayCode,
    stageId: level.stageId,
    stageName: level.name,
    needsVerification: nameMismatch || undefined,
  };
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

/**
 * 综合文本与画面提示。文本显式码最高优先，其次关卡库通名，最后网格位置。
 * 网格内通名与位置结果不一致时，位置胜出并标记 needsVerification。
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

  const hintedCode = extractDispatchCode(vision?.explicitCode ?? "");
  if (hintedCode) {
    const level = exactLevelByCode(levels, hintedCode);
    return level
      ? resolutionFromLevel(level, "text_code")
      : { source: "text_code", displayCode: hintedCode };
  }

  const hintedName = vision?.matchedName?.trim() ?? "";
  if (hintedName) {
    const level = exactLevelByName(dispatchLevels(levels), hintedName);
    if (level) return resolutionFromLevel(level, "level_name");
  }

  const position = vision ? normalizeGridPosition(vision) : undefined;
  const gridHints = vision ? collectGridHints(vision) : [];
  if (!position && gridHints.length === 0) return { source: "unknown" };

  const context = [stage, videoTitle, extraText].filter(Boolean).join("\n");
  const prefix = inferEventPrefix(context, levels);
  const stages = prefix ? listDispatchStagesFromLevels(levels, prefix) : [];
  if (!prefix || stages.length === 0) {
    return {
      source: "unknown",
      gridPosition: position,
      gridName: vision?.gridName,
      note: "截图像是特别战线网格，但未能确定所属活动，请核实关卡编号",
    };
  }

  const candidates: StageGridCandidate[] = [];
  const invalidPositions: number[] = [];
  for (const hint of gridHints.length ? gridHints : [{ position: position! }]) {
    const level = codeFromGridPosition(hint.position, stages);
    if (level) candidates.push(candidateFromLevel(hint, level));
    else invalidPositions.push(hint.position);
  }

  if (candidates.length === 0) {
    return {
      source: "grid",
      gridPosition: position ?? gridHints[0]?.position,
      gridName: vision?.gridName,
      needsVerification: true,
      note: `截图网格位置 ${invalidPositions.join("、")} 超出该活动的派遣关范围，请核实`,
    };
  }

  const mismatchNotes = candidates
    .filter((candidate) => candidate.needsVerification)
    .map(
      (candidate) =>
        `截图通名“${candidate.gridName}”与位置推算“${candidate.stageName}”不一致，已按网格位置采用 ${candidate.displayCode}`,
    );
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
): Promise<{ resolution: StageResolution; displayStage: string }> {
  const levels = await getLevelDb().catch(() => []);
  const resolution = resolveStageWithVision(stage, videoTitle, extraText, vision, levels);
  return { resolution, displayStage: formatStageResolution(resolution, stage) };
}
