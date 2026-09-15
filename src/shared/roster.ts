/**
 * ① 阵容提取（设计见 docs/design.md §4-① / §4.1，2026-09-13 修订）。
 *
 * 主路径 = 用户提供的画面（三通道：content script 抓视频当前帧 / Ctrl+V 粘贴 / 文件导入）：
 * DeepSeek 多模态从编队页帧提取干员名单（含助战位）→ 干员名字典校验。
 *
 * 简介/置顶评论**降级为辅助上下文**（帮助 LLM 识别技能/专精说明），
 * 不再单独产出结果集（实测：简介列的是全合集常用干员，非本关部署）。
 * 开局帧部署顺序字幕：暂缓（并非所有视频都有）。
 */

import { callLLM, parseJsonLoose, type AskFn } from "./llm";
import { getVideoInfo, type VideoInfo } from "./bilibili";
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

/** 辅助上下文：简介 + 置顶评论（供画面提取时参考技能/练度说明）。
 *  评论列表由调用方传入（复用已抓取的 200 条，避免重复请求）。 */
export function buildTextContext(video: VideoInfo, comments: Array<{ text: string; isPinned: boolean }>): string {
  const pinned = comments
    .filter((c) => c.isPinned)
    .map((c) => c.text)
    .join("\n---\n");
  return [
    video.desc ? `【视频简介】\n${video.desc}` : "",
    pinned ? `【置顶评论】\n${pinned}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

interface ExtractedOperator {
  name?: string;
  support?: boolean;
  isKey?: boolean;
  keyReason?: string;
}

/** 主路径：从用户提供的画面（可多张：编队页 + 助战详情页）提取阵容 */
export async function extractRosterFromImage(
  meta: StageMeta,
  imageDataUrls: string[],
  opDB: OperatorDB,
  textContext: string,
  ask: AskFn = callLLM,
): Promise<Roster> {
  const raw = await ask([
    { role: "system", content: "你是明日方舟攻略阵容提取引擎，只输出 JSON。" },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `任务：这些是明日方舟关卡 ${meta.stage} 攻略视频的画面截图。提取视频阵容中的干员名单。`,
            ``,
            `截图说明（可能有多种组合）：`,
            `- 编队页（「快捷编队/开始行动」UI）：干员卡片下方是干员名；右上角橙色「助战干员 SUPPORT UNIT」标签会盖住该卡片的名字——助战位名字以助战详情页截图为准`,
            `- 助战详情页（「招募助战」按钮）：干员名是大字（如「结城理」），该干员 support: true`,
            `- 摆位画面：干员血条旁/底部头像条`,
            ``,
            `视频文字材料（辅助参考，画面为准）：`,
            textContext || "（无）",
            ``,
            `昵称/黑话对照表：`,
            JSON.stringify(ALIASES.aliases),
            ``,
            `规则：`,
            `- name：画面上的干员名，逐字识别后按对照表还原全名；名字被遮挡且无其他截图佐证时跳过，不要猜测`,
            `- 助战干员（好友干员）support: true`,
            `- 视频简介中强调为「核心/关键/必须有」的干员 isKey: true，keyReason 说明`,
            `- 只输出画面中确认存在的干员，不要从简介推测补充`,
            ``,
            `仅输出 JSON：{"operators":[{"name":"","support":false,"isKey":false,"keyReason":""}]}`,
          ].join("\n"),
        },
        ...imageDataUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
      ],
    },
  ]);

  let parsed: { operators?: ExtractedOperator[] };
  try {
    parsed = parseJsonLoose<{ operators?: ExtractedOperator[] }>(raw);
  } catch {
    throw new Error("画面识别失败：LLM 返回无法解析，请重试");
  }

  const slots: RosterSlot[] = [];
  const rejected: string[] = [];
  for (const op of parsed.operators ?? []) {
    const name = opDB.resolve((op.name ?? "").trim());
    if (!name) continue;
    if (!opDB.exists(name)) {
      rejected.push(op.name ?? "");
      continue; // 字典校验：拦截幻觉名/误识别
    }
    slots.push({
      operator: opDB.get(name)!.name,
      isKey: !!op.isKey,
      keyReason: op.keyReason || undefined,
      support: !!op.support,
    });
  }
  const dedup = [...new Map(slots.map((s) => [s.operator, s])).values()];

  if (dedup.length === 0) {
    throw new Error(
      `画面中未能识别出干员` +
        (rejected.length ? `（字典无法识别：${rejected.join("、")}）` : "") +
        `。请确认截图是编队/阵容画面后重试`,
    );
  }

  return {
    stage: meta.stage,
    videoId: meta.video.bvid,
    page: meta.page,
    slots: dedup,
    source: "screenshot",
  };
}
