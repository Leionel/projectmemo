/**
 * 阶段检查点 → 待办 → 日历提醒。
 *
 * 三条硬约束：
 * 1. 检查点只提供建议。没有显式确认（confirm=true）不创建任何业务数据；
 * 2. 幂等靠稳定 dedupeKey（revisionId + claimId）而不是随机 requestId：
 *    重复点击、响应丢失后重试都只会得到同一条待办；已存在时复用并导航过去；
 * 3. 建议所依据的来源发生变化后，旧建议不能静默执行。
 */
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import { evaluateEpisodeFreshness } from "@/lib/services/projectEpisodeService";
import type { EpisodeClaim } from "@/lib/types/episode";

export type EpisodeActionMode = "SUGGESTION" | "UNBLOCK";

export interface EpisodeActionInput {
  claimId: string;
  /** 用户明确确认才创建业务数据；缺少或为 false 一律拒绝 */
  confirm: boolean;
  mode?: EpisodeActionMode;
  /** mode=UNBLOCK 时被阻塞的待办 */
  unblockTargetActionId?: string;
  priority?: number;
  estimatedMinutes?: number;
}

export interface EpisodeActionOutcome {
  actionId: string;
  reused: boolean;
  title: string;
  status: string;
  source: { episodeId: string; revisionId: string; revision: number; claimId: string };
  availability: {
    status: "READY" | "BLOCKED" | "UNKNOWN";
    summary: string;
    /** 可直接安排提醒；受阻时为 false，界面显示「先处理阻塞」 */
    canArrangeReminder: boolean;
    blockedReason: string | null;
    /** 受阻时提供的解阻入口，不把用户丢在死路里 */
    entries: Array<{ kind: "ADD_REQUIREMENT" | "ADD_INFORMATION" | "CREATE_UNBLOCK_ACTION"; label: string; targetActionId: string }>;
  };
}

function ensureEpisodesEnabled() {
  if (!isFeatureEnabled("PROJECT_EPISODES_ENABLED", false)) {
    throw new AppError("PROJECT_EPISODES_DISABLED", "阶段检查点功能当前已关闭", 503);
  }
}

/** 从建议文案里取出行动标题；取不到时退化为整句，不编造标题 */
export function deriveActionTitle(claimText: string): string {
  const quoted = /「([^」]{1,80})」/.exec(claimText);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  return claimText.trim().slice(0, 80) || "来自检查点的下一步";
}

function buildUnblockEntries(actionId: string): EpisodeActionOutcome["availability"]["entries"] {
  return [
    { kind: "ADD_REQUIREMENT", label: "补充前置依赖", targetActionId: actionId },
    { kind: "ADD_INFORMATION", label: "补充缺失的信息", targetActionId: actionId },
    { kind: "CREATE_UNBLOCK_ACTION", label: "创建一个解阻待办", targetActionId: actionId },
  ];
}

/**
 * 从检查点建议创建（或复用）待办。
 *
 * 复用优先级：建议里已指向的现存待办 → 幂等键已创建过的待办 → 新建。
 */
export async function createActionFromEpisodeSuggestion(
  projectId: string,
  episodeId: string,
  input: EpisodeActionInput,
): Promise<EpisodeActionOutcome> {
  ensureEpisodesEnabled();
  if (input.confirm !== true) {
    throw new AppError("CONFIRMATION_REQUIRED", "检查点只提供建议，请先确认再加入待办", 422);
  }
  if (!input.claimId?.trim()) {
    throw new AppError("VALIDATION_ERROR", "缺少建议标识", 422);
  }
  const mode: EpisodeActionMode = input.mode ?? "SUGGESTION";

  const episode = await db.projectEpisode.findFirst({ where: { id: episodeId, projectId } });
  if (!episode) {
    throw new AppError("EPISODE_NOT_FOUND", "阶段检查点不存在或不属于当前项目", 404);
  }
  const revision = await db.episodeRevision.findFirst({
    where: { episodeId: episode.id, status: "PUBLISHED" },
    orderBy: { revision: "desc" },
  });
  if (!revision) {
    throw new AppError("EPISODE_NOT_PUBLISHED", "这个检查点还没有确认版本，请先确认", 409);
  }

  const claims = (Array.isArray(revision.claims) ? revision.claims : []) as unknown as EpisodeClaim[];
  const claim = claims.find((item) => item.claimId === input.claimId);
  if (!claim) {
    throw new AppError("EPISODE_CLAIM_NOT_FOUND", "这条建议不存在于当前确认版本，请刷新检查点", 404);
  }

  // 来源变化后旧建议不能静默执行：整份过期或该句受影响都要求重新生成
  const freshness = await evaluateEpisodeFreshness(projectId, revision);
  if (freshness.status === "STALE") {
    throw new AppError("EPISODE_STALE", "阶段检查点已过期，请先重新生成新版本再执行建议", 409);
  }
  const affected = freshness.affectedClaims.find((item) => item.claimId === claim.claimId);
  if (freshness.status === "PARTIALLY_STALE" && affected) {
    throw new AppError("EPISODE_CLAIM_STALE", `这条建议所依据的来源已经变化：${affected.reason}。请重新生成检查点`, 409);
  }

  const dedupeKey = mode === "UNBLOCK"
    ? `unblock:${revision.id}:${claim.claimId}:${input.unblockTargetActionId ?? "none"}`
    : `episode:${revision.id}:${claim.claimId}`;

  // 1) 建议本身已指向一条现存待办：直接复用，界面导航过去
  if (mode === "SUGGESTION" && claim.suggestedActionId) {
    const existing = await db.actionItem.findFirst({
      where: { id: claim.suggestedActionId, projectId, status: { not: "CANCELLED" } },
    });
    if (existing) {
      return await describeOutcome(existing.id, existing.title, existing.status, true, {
        episodeId: episode.id,
        revisionId: revision.id,
        revision: revision.revision,
        claimId: claim.claimId,
      }, projectId);
    }
  }

  // 2) 幂等键已经创建过：重复点击直接复用
  const byKey = await db.actionItem.findFirst({ where: { dedupeKey } });
  if (byKey) {
    if (byKey.projectId !== projectId) {
      throw new AppError("ACTION_DEDUPE_CONFLICT", "该建议的幂等键已被其他项目占用", 409);
    }
    return await describeOutcome(byKey.id, byKey.title, byKey.status, true, {
      episodeId: episode.id,
      revisionId: revision.id,
      revision: revision.revision,
      claimId: claim.claimId,
    }, projectId);
  }

  // 3) 新建。dedupeKey 的唯一约束负责收口并发重复点击
  let title = mode === "UNBLOCK" ? "解阻：补充前置事项" : deriveActionTitle(claim.text);
  if (mode === "UNBLOCK" && input.unblockTargetActionId) {
    const blocked = await db.actionItem.findFirst({ where: { id: input.unblockTargetActionId, projectId } });
    if (!blocked) {
      throw new AppError("ACTION_NOT_FOUND", "要解阻的待办不存在或不属于当前项目", 404);
    }
    title = `解阻：${blocked.title}`.slice(0, 160);
  }

  const description = mode === "UNBLOCK"
    ? `来自阶段检查点 V${revision.revision} 的解阻建议：先让「${input.unblockTargetActionId ?? ""}」具备开始条件。`
    : `来自阶段检查点 V${revision.revision}：${claim.text}`;

  try {
    const created = await db.actionItem.create({
      data: {
        projectId,
        title,
        description,
        priority: input.priority ?? 3,
        status: "TODO",
        estimatedMinutes: input.estimatedMinutes ?? null,
        dedupeKey,
      },
    });
    return await describeOutcome(created.id, created.title, created.status, false, {
      episodeId: episode.id,
      revisionId: revision.id,
      revision: revision.revision,
      claimId: claim.claimId,
    }, projectId);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    if (code !== "P2002") throw error;
    const raced = await db.actionItem.findFirst({ where: { dedupeKey } });
    if (raced && raced.projectId === projectId) {
      return await describeOutcome(raced.id, raced.title, raced.status, true, {
        episodeId: episode.id,
        revisionId: revision.id,
        revision: revision.revision,
        claimId: claim.claimId,
      }, projectId);
    }
    throw new AppError("ACTION_DEDUPE_CONFLICT", "该建议的幂等键已被其他项目占用", 409);
  }
}

async function describeOutcome(
  actionId: string,
  title: string,
  status: string,
  reused: boolean,
  source: EpisodeActionOutcome["source"],
  projectId: string,
): Promise<EpisodeActionOutcome> {
  const { assessActionFeasibility } = await import("@/lib/services/actionFeasibilityService");
  const assessment = await assessActionFeasibility(projectId, actionId);
  const reminderEnabled = isFeatureEnabled("PROJECT_CALENDAR_REMINDER_ENABLED", false);
  const schedulable = status === "TODO" || status === "DOING";
  const ready = schedulable && assessment.feasibility === "READY";

  let blockedReason: string | null = null;
  if (!schedulable) {
    blockedReason = "这条待办已经完成或取消，不能再安排提醒。";
  } else if (assessment.feasibility === "BLOCKED") {
    blockedReason = `${assessment.summary} 先处理阻塞，再安排提醒。`;
  } else if (assessment.feasibility === "UNKNOWN") {
    blockedReason = `${assessment.summary} 先补充缺失的信息，再安排提醒。`;
  }

  return {
    actionId,
    reused,
    title,
    status,
    source,
    availability: {
      status: assessment.feasibility,
      summary: assessment.summary,
      canArrangeReminder: ready && reminderEnabled,
      blockedReason,
      entries: schedulable && assessment.feasibility !== "READY" ? buildUnblockEntries(actionId) : [],
    },
  };
}
