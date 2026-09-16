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
  try {
    const feedback = await db.interventionFeedback.create({
      data: {
        projectId,
        interventionId,
        feedbackType: input.feedbackType,
        reason: normalizeReason(input.reason),
      },
    });
    return { feedback, created: true };
  } catch (error) {
    // 两个设备同时上报同一种反馈时，以数据库唯一约束为幂等闸门。
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "P2002") {
      const feedback = await db.interventionFeedback.findUnique({
        where: { interventionId_feedbackType: { interventionId, feedbackType: input.feedbackType } },
      });
      if (feedback) return { feedback, created: false };
    }
    throw error;
  }
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
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  // 同一提醒的相反反馈是一次修订，不是两次独立样本；只统计最近一条
  // ACCEPTED/IGNORED，保留所有原始事件供审计。
  const latestByIntervention = new Map<string, typeof feedbacks[number]>();
  for (const feedback of feedbacks) {
    if (!latestByIntervention.has(feedback.interventionId)) {
      latestByIntervention.set(feedback.interventionId, feedback);
    }
  }
  const stats = new Map<string, TopicFeedbackStats>();
  for (const feedback of latestByIntervention.values()) {
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
  const preferences = await db.interventionPreference.findMany({ where: { projectId } });
  const preferenceByTopic = new Map(preferences.map((item) => [item.triggerType, item]));

  const stats = await topicFeedbackStats(projectId);
  const suggestions: Array<{ triggerType: string; ignoredCount: number; text: string }> = [];
  for (const stat of stats) {
    const preference = preferenceByTopic.get(stat.triggerType);
    if (preference?.reducedSince || preference?.suggestionDismissedAt) continue;
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

export async function listProjectPreferences(projectId: string) {
  const preferences = await db.interventionPreference.findMany({
    where: { projectId, reducedSince: { not: null } },
    orderBy: { triggerType: "asc" },
  });
  return preferences.map((item) => ({
    triggerType: item.triggerType,
    since: item.reducedSince?.toISOString() ?? null,
  }));
}

export async function confirmSuggestion(projectId: string, triggerType: string, policyScope = "GLOBAL") {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
    // 在同一事务内读取并合并旧 JSON，避免两个项目同时确认不同主题时互相覆盖。
    const policy = await tx.interventionPolicy.upsert({
      where: { scope: policyScope },
      create: { scope: policyScope },
      update: {},
    });
    const reduced = Array.isArray(policy.reducedTopics)
      ? (policy.reducedTopics as Array<{ triggerType: string; projectId?: string; since: string }>)
      : [];
    if (!reduced.some((item) => item.triggerType === triggerType && item.projectId === projectId)) {
      reduced.push({ triggerType, projectId, since: now.toISOString() });
    }
    await tx.interventionPreference.upsert({
      where: { projectId_triggerType: { projectId, triggerType } },
      create: { projectId, triggerType, reducedSince: now, suggestionDismissedAt: null },
      update: { reducedSince: now, suggestionDismissedAt: null },
    });
    await tx.interventionPolicy.update({
      where: { id: policy.id },
      data: { reducedTopics: reduced as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    return tx.interventionPolicy.findUniqueOrThrow({ where: { id: policy.id } });
  });
}

export async function dismissSuggestion(projectId: string, triggerType: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
  return db.interventionPreference.upsert({
    where: { projectId_triggerType: { projectId, triggerType } },
    create: { projectId, triggerType, suggestionDismissedAt: new Date() },
    update: { suggestionDismissedAt: new Date() },
  });
}

/** 撤销降频：延期是时间偏好，单次忽略不永久屏蔽；恢复后新证据仍会重新评估 */
export async function revertTopicReduction(projectId: string, triggerType: string, policyScope = "GLOBAL") {
  return db.$transaction(async (tx) => {
    const project = await tx.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);
    const policy = await tx.interventionPolicy.upsert({
      where: { scope: policyScope },
      create: { scope: policyScope },
      update: {},
    });
    const reduced = Array.isArray(policy.reducedTopics)
      ? (policy.reducedTopics as Array<{ triggerType: string; projectId?: string; since: string }>)
          .filter((item) => item.triggerType !== triggerType || item.projectId !== projectId)
      : [];
    await tx.interventionPreference.updateMany({
      where: { projectId, triggerType },
      data: { reducedSince: null },
    });
    await tx.interventionPolicy.update({
      where: { id: policy.id },
      data: { reducedTopics: reduced as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
    });
    return tx.interventionPolicy.findUniqueOrThrow({ where: { id: policy.id } });
  });
}
