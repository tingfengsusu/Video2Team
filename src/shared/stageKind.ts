/**
 * v4.2 关卡类型分流。
 *
 * 派遣关的阵容会被占用清单锁定；推图关只是使用占用约束来替换推荐，
 * 因此绝不能把推图关的阵容加入占用清单。
 */

import type { StageResolution } from "./types";

export type StageKind = "dispatch" | "target" | "unknown";
export type StageKindSource = "rule" | "override";

export interface StageKindOverride {
  kind: "dispatch" | "target";
  updatedAt: number;
}

export type StageKindOverrides = Record<string, StageKindOverride>;

export interface StageKindResolution {
  kind: StageKind;
  source: StageKindSource;
  key: string;
}

export const STAGE_KIND_OVERRIDES_KEY = "stageKindOverrides";

const DISPATCH_RE = /(?:VEC[\s_-]*SP(?:[\s_-]*\d{1,2})?|特别战线|驻防)/i;
const TARGET_RE = /(?:核心突破|全力以赴|VEC[\s_-]*[A-D](?:$|[^A-Z0-9_-]))/i;

function classifyText(text: string): StageKind {
  const value = String(text ?? "").trim();
  if (!value) return "unknown";
  if (DISPATCH_RE.test(value)) return "dispatch";
  if (TARGET_RE.test(value)) return "target";
  return "unknown";
}

/** stage 字段优先于视频标题，避免合集标题干扰当前分P。 */
export function classifyStage(stage: string, videoTitle = ""): StageKind {
  const stageKind = classifyText(stage);
  return stageKind === "unknown" ? classifyText(videoTitle) : stageKind;
}

export function stageKindOverrideKey(stage: string, videoTitle = ""): string {
  return String(stage || videoTitle || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function resolveStageKind(
  stage: string,
  videoTitle: string,
  overrides: StageKindOverrides = {},
): StageKindResolution {
  const key = stageKindOverrideKey(stage, videoTitle);
  const override = key ? overrides[key] : undefined;
  if (override?.kind === "dispatch" || override?.kind === "target") {
    return { kind: override.kind, source: "override", key };
  }
  return { kind: classifyStage(stage, videoTitle), source: "rule", key };
}

/** 截图有多个候选 yellow 格但无法定位当前关时，不允许写入占用清单。 */
export function isAmbiguousStageResolution(
  resolution: StageResolution | undefined,
): boolean {
  return resolution?.source === "unknown" && (resolution.gridCandidates?.length ?? 0) > 1;
}

/** 两个结果入口共用，防止 popup / 视频页面板行为漂移。 */
export function shouldShowDispatchAction(
  kind: StageKind,
  ambiguousResolution = false,
): boolean {
  return kind === "dispatch" && !ambiguousResolution;
}

function normalizeOverrides(raw: unknown): StageKindOverrides {
  if (!raw || typeof raw !== "object") return {};
  const out: StageKindOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key.trim() || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (v.kind !== "dispatch" && v.kind !== "target") continue;
    out[key] = {
      kind: v.kind,
      updatedAt: Number(v.updatedAt) || 0,
    };
  }
  return out;
}

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local;
}

const memoryOverrides: { value: StageKindOverrides } = { value: {} };

export async function getStageKindOverrides(): Promise<StageKindOverrides> {
  if (!hasChromeStorage()) return { ...memoryOverrides.value };
  try {
    const stored = (await chrome.storage.local.get(STAGE_KIND_OVERRIDES_KEY)) as Record<string, unknown>;
    return normalizeOverrides(stored[STAGE_KIND_OVERRIDES_KEY]);
  } catch {
    return {};
  }
}

/** 仅用于“无法自动判断”的关卡；返回更新后的完整覆盖表。 */
export async function setStageKindOverride(
  stage: string,
  videoTitle: string,
  kind: "dispatch" | "target",
): Promise<StageKindOverrides> {
  const key = stageKindOverrideKey(stage, videoTitle);
  if (!key) return getStageKindOverrides();
  const current = await getStageKindOverrides();
  const next: StageKindOverrides = {
    ...current,
    [key]: { kind, updatedAt: Date.now() },
  };
  if (hasChromeStorage()) await chrome.storage.local.set({ [STAGE_KIND_OVERRIDES_KEY]: next });
  else memoryOverrides.value = next;
  return next;
}
