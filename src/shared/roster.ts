/**
 * ① 阵容提取（设计见 docs/design.md §4-①）。
 *
 * v0 路径：视频简介 / 置顶评论（UP主通常写明阵容）→ DeepSeek 提取。
 * 兜底路径：抽帧 OCR + 多模态（依赖 v1+ 可选本地分析服务），文本路径失败时明确告知用户。
 * 同时从素材中标记关键位（isKey），供风险分级用。
 */

import { callDeepSeek, parseJsonLoose } from "./deepseek";
import { getVideoInfo, fetchComments, type VideoInfo } from "./bilibili";
import type { OperatorDB } from "./operatorDB";
import type { Roster, RosterSlot } from "./types";
import ALIASES from "../../data/aliases.json";

export interface StageMeta {
  video: VideoInfo;
  page: number | null; // 分P序号；独立视频为 null
  stage: string; // 关卡名
  cid: number | null;
}

/** 定位分析关卡：多分P视频按 ?p= 选分P（part 标题即关卡名，实测见 notes/recon.md） */
export async function locateStage(bvid: string, page?: number): Promise<StageMeta> {
  const video = await getVideoInfo(bvid);
  if (video.pages.length > 1) {
    const p = page ?? 1;
    const pg = video.pages.find((x) => x.page === p) ?? video.pages[0]!;
    return { video, page: pg.page, stage: pg.part, cid: pg.cid };
  }
  return { video, page: null, stage: video.title, cid: video.cid };
}

interface ExtractedSlot {
  operator?: string;
  skill?: number;
  mastery?: number;
  deployOrder?: number;
  isKey?: boolean;
  keyReason?: string;
}

export async function extractRoster(meta: StageMeta, opDB: OperatorDB): Promise<Roster> {
  const comments = await fetchComments(meta.video.aid, 20);
  const pinned = comments
    .filter((c) => c.isPinned)
    .map((c) => c.text)
    .join("\n---\n");
  const sources = [
    meta.video.desc ? `【视频简介】\n${meta.video.desc}` : "",
    pinned ? `【置顶评论】\n${pinned}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  if (!sources) {
    throw new Error(
      "视频简介和置顶评论均为空，无法提取阵容。该视频需要抽帧 OCR 兜底（依赖可选本地分析服务，v1 提供）",
    );
  }

  const raw = await callDeepSeek([
    { role: "system", content: "你是明日方舟攻略阵容提取引擎，只输出 JSON。" },
    {
      role: "user",
      content: [
        `任务：从攻略视频的简介/置顶评论中提取关卡 ${meta.stage} 的挂机阵容。`,
        `干员名可能使用昵称/黑话，请按对照表还原为全名：`,
        JSON.stringify(ALIASES.aliases),
        ``,
        `素材：`,
        sources,
        ``,
        `规则：`,
        `- 素材中若列出的是「常用干员」等未区分关卡的泛列（合集视频常见），视作本关可用阵容提取`,
        `- skill：技能序号(1/2/3)；mastery：专精等级(1-3)；deployOrder：部署顺序（素材有说明才填）`,
        `- isKey：素材明确强调的关键/核心干员（如「必须有」「核心」「关键」），keyReason 说明原因`,
        `- 素材无法确认的字段留空`,
        ``,
        `仅输出 JSON：{"stage":"${meta.stage}","slots":[{"operator":"","skill":null,"mastery":null,"deployOrder":null,"isKey":false,"keyReason":""}]}`,
      ].join("\n"),
    },
  ]);

  let parsed: { slots?: ExtractedSlot[] };
  try {
    parsed = parseJsonLoose<{ slots?: ExtractedSlot[] }>(raw);
  } catch {
    throw new Error("阵容提取失败：LLM 返回无法解析，请重试");
  }

  const slots: RosterSlot[] = [];
  const rejected: string[] = [];
  for (const s of parsed.slots ?? []) {
    const name = opDB.resolve((s.operator ?? "").trim());
    if (!name) continue;
    if (!opDB.exists(name)) {
      rejected.push(s.operator ?? "");
      continue; // 字典校验失败：幻觉名或还原错误，拦截
    }
    slots.push({
      operator: opDB.get(name)!.name,
      skill: s.skill ?? undefined,
      mastery: s.mastery ?? undefined,
      deployOrder: s.deployOrder ?? undefined,
      isKey: !!s.isKey,
      keyReason: s.keyReason || undefined,
    });
  }
  const dedup = [...new Map(slots.map((s) => [s.operator, s])).values()];

  if (dedup.length === 0) {
    throw new Error(
      `未能从简介/置顶评论识别出阵容` +
        (rejected.length ? `（字典无法识别：${rejected.join("、")}）` : "") +
        `。该视频可能需要抽帧 OCR 兜底（v1 可选本地服务）`,
    );
  }

  return {
    stage: meta.stage,
    videoId: meta.video.bvid,
    page: meta.page,
    slots: dedup,
    source: pinned ? "pinned_comment" : "description",
  };
}
