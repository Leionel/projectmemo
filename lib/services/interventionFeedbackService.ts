import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";

export const FEEDBACK_TYPES = [
  "ACCEPTED",
  "SNOOZED",
  "IGNORED",
  "WORTH_IT",
  "NOT_USEFUL",
  "KEEP_UNKNOWN",
  "EXPOSED",
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPES)[number];

function normalizeReason(reason?: string): string | null {
  const trimmed = reason?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

/**
 * 独立反馈事件：曝光与反馈分开记录；重复反馈幂等（同键返回既有记录）。
 * 反馈不直接改变干预状态——状态更新仍走既有 interventions 路由。
 */
export async function recordFeedback(
  projectId: string,
  interventionId: string,
  input: { feedbackType: FeedbackType; reason?: string },
) {
  const intervention = await db.agentIntervention.findFirst({
    where: { id: interventionId, projectId },
  });
  if (!intervention) {
    throw new AppError("INTERVENTION_NOT_FOUND", "提醒不存在或不属于当前项目", 404);
  }
  const existing = await db.interventionFeedback.findUnique({
    where: {
      interventionId_feedbackType: {
        interventionId,
        feedbackType: input.feedbackType,
      },
    },
  });
  if (existing) {
    return { feedback: existing, created: false };
  }
  const feedback = await db.interventionFeedback.create({
    data: {
      projectId,
      interventionId,
      feedbackType: input.feedbackType,
      reason: normalizeReason(input.reason),
    },
  });
  return { feedback, created: true };
}

export interface TopicFeedbackStats {
  triggerType: string;
  ignoredCount: number;
  acceptedCount: number;
}

export async function topicFeedbackStats(projectId: string): Promise<TopicFeedbackStats[]> {
  const since = new Date(Date.now() - 14 * 86400000);
  const feedbacks = await db.interventionFeedback.findMany({
    where: {
      projectId,
      createdAt: { gte: since },
      feedbackType: { in: ["IGNORED", "ACCEPTED"] },
    },
    include: { intervention: { select: { triggerType: true } } },
  });
  const stats = new Map<string, TopicFeedbackStats>();
  for (const feedback of feedbacks) {
    const triggerType = String(feedback.intervention.triggerType);
    const entry = stats.get(triggerType) ?? { triggerType, ignoredCount: 0, acceptedCount: 0 };
    if (feedback.feedbackType === "IGNORED") entry.ignoredCount += 1;
    if (feedback.feedbackType === "ACCEPTED") entry.acceptedCount += 1;
    stats.set(triggerType, entry);
  }
  return [...stats.values()];
}

/**
 * 可解释偏好建议：同一主题 14 天内至少 3 次独立明确忽略且没有接受时，
 * 提出一次「降低此类提醒频率」建议。阈值是产品默认，不是研究结论。
 */
export async function computeSuggestion(projectId: string) {
  const policy = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
  const reduced = new Set(
    Array.isArray(policy?.reducedTopics)
      ? (policy?.reducedTopics as Array<{ triggerType?: string }>)
          .map((item) => item?.triggerType)
          .filter((item): item is string => typeof item === "string")
      : [],
  );
  const suggestionState = (policy?.suggestionState && typeof policy.suggestionState === "object" && !Array.isArray(policy.suggestionState)
    ? policy.suggestionState as Record<string, { suggestedAt?: string; dismissedAt?: string }>
    : {}) as Record<string, { suggestedAt?: string; dismissedAt?: string }>;

  const stats = await topicFeedbackStats(projectId);
  const suggestions: Array<{ triggerType: string; ignoredCount: number; text: string }> = [];
  for (const stat of stats) {
    if (reduced.has(stat.triggerType)) continue;
    const state = suggestionState[stat.triggerType];
    if (state?.dismissedAt) continue;
    if (stat.ignoredCount >= 3 && stat.acceptedCount === 0) {
      suggestions.push({
        triggerType: stat.triggerType,
        ignoredCount: stat.ignoredCount,
        text: `过去 14 天你有 ${stat.ignoredCount} 次明确忽略了「${stat.triggerType}」类提醒且没有接受记录。要降低这类提醒的频率吗？（每天最多 1 次，可随时恢复）`,
      });
    }
  }
  return suggestions;
}

export async function confirmSuggestion(projectId: string, triggerType: string) {
  const policy = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
  if (!policy) throw new AppError("POLICY_NOT_FOUND", "策略尚未初始化", 404);
  const reduced = Array.isArray(policy.reducedTopics)
    ? (policy.reducedTopics as Array<{ triggerType: string; since: string }>)
    : [];
  if (!reduced.some((item) => item.triggerType === triggerType)) {
    reduced.push({ triggerType, since: new Date().toISOString() });
  }
  const state = (policy.suggestionState && typeof policy.suggestionState === "object" && !Array.isArray(policy.suggestionState)
    ? policy.suggestionState as Record<string, unknown>
    : {}) as Record<string, unknown>;
  delete state[triggerType];
  return db.interventionPolicy.update({
    where: { id: policy.id },
    data: {
      reducedTopics: reduced as unknown as Prisma.InputJsonValue,
      suggestionState: state as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}

export async function dismissSuggestion(projectId: string, triggerType: string) {
  const policy = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
  if (!policy) throw new AppError("POLICY_NOT_FOUND", "策略尚未初始化", 404);
  const state = (policy.suggestionState && typeof policy.suggestionState === "object" && !Array.isArray(policy.suggestionState)
    ? policy.suggestionState as Record<string, unknown>
    : {}) as Record<string, unknown>;
  state[triggerType] = { dismissedAt: new Date().toISOString() };
  return db.interventionPolicy.update({
    where: { id: policy.id },
    data: { suggestionState: state as unknown as Prisma.InputJsonValue },
  });
}

/** 撤销降频：延期是时间偏好，单次忽略不永久屏蔽；恢复后新证据仍会重新评估 */
export async function revertTopicReduction(projectId: string, triggerType: string) {
  const policy = await db.interventionPolicy.findUnique({ where: { scope: "GLOBAL" } });
  if (!policy) throw new AppError("POLICY_NOT_FOUND", "策略尚未初始化", 404);
  const reduced = Array.isArray(policy.reducedTopics)
    ? (policy.reducedTopics as Array<{ triggerType: string; since: string }>)
        .filter((item) => item.triggerType !== triggerType)
    : [];
  return db.interventionPolicy.update({
    where: { id: policy.id },
    data: {
      reducedTopics: reduced as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });
}
