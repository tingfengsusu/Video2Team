/**
 * 全局常量（少量、易改）。
 */

/**
 * 作者B站 UID（§5 反馈直达私信）。
 * 已填：1819482012（作者空间 https://space.bilibili.com/1819482012）。
 * 主按钮「复制并打开我的B站私信」会打开 https://message.bilibili.com/#/whisper/mid1819482012 。
 * 留空时该按钮自动降级为「仅复制」。
 */
export const FEEDBACK_MID = "1819482012";

/** GitHub Issue 预填口径（备用反馈出口） */
export const REPO_ISSUES_URL = "https://github.com/tingfengsusu/Video2Team/issues/new";

/** B站私信页（作者 UID 拼接） */
export function feedbackDmUrl(mid: string): string {
  const id = String(mid ?? "").trim();
  return id ? `https://message.bilibili.com/#/whisper/mid${id}` : "";
}

/**
 * 特别战线的「关卡链」（第十一轮 q4，用户实测）：某些派遣关必须先打掉它的**前置关**——
 * 打前置关同样要占干员，所以程序侧自动把前置关一并纳入候选池，不需要模型判断。
 * 实测：VEC-SP10 → VEC-SP09、VEC-SP12 → VEC-SP11（键为后置关，值为它的前置关）。
 * 以后活动出现别的链条，往这张表里加一行即可。
 */
export const DISPATCH_STAGE_CHAIN: Record<string, string> = {
  "VEC-SP10": "VEC-SP09",
  "VEC-SP12": "VEC-SP11",
};

/**
 * 给定一批关（已识别/已选/手动补的），返回需要**一并纳入**的前置关显示码（去重、排除已在列表里的）。
 * 支持链式（A→B→C）：顺着表往下走，带 visited 防环。
 */
export function chainPrereqs(codes: readonly string[]): string[] {
  const have = new Set((codes ?? []).map((c) => String(c ?? "").trim().toUpperCase()));
  const out: string[] = [];
  const visited = new Set<string>(have);
  const queue = [...have];
  while (queue.length) {
    const code = queue.shift()!;
    const prev = DISPATCH_STAGE_CHAIN[code];
    if (!prev || visited.has(prev)) continue;
    visited.add(prev);
    out.push(prev);
    queue.push(prev);
  }
  return out;
}

/** 结果里实际出现的依赖关系（依赖关 → 前置关），供界面写「关卡链」说明 */
export function chainMapFor(codes: readonly string[]): Record<string, string> | undefined {
  const have = new Set((codes ?? []).map((c) => String(c ?? "").trim().toUpperCase()));
  const out: Record<string, string> = {};
  for (const [dep, prev] of Object.entries(DISPATCH_STAGE_CHAIN)) {
    if (have.has(dep.toUpperCase())) out[dep.toUpperCase()] = prev;
  }
  return Object.keys(out).length ? out : undefined;
}
