import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import type {
  ReentryData,
  ReentryEpisodePart,
  ReentryPrimaryAction,
  ReentryRiskPart,
  ReentrySchedulePart,
  ReentrySectionMeta,
} from "@/lib/types/reentry";
import { getLatestPublishedEpisode } from "@/lib/services/projectEpisodeService";
import { getCurrentSchedulePlan } from "@/lib/services/scheduleService";
import { getLatestProjectState, getProjectStateDiff } from "@/lib/services/projectStateService";

function ensureReentryEnabled() {
  if (!isFeatureEnabled("PROJECT_REENTRY_ENABLED", false)) {
    throw new AppError("PROJECT_REENTRY_DISABLED", "继续推进功能当前已关闭", 503);
  }
}

function okMeta(observedAt: string | null): ReentrySectionMeta {
  return { status: "OK", observedAt, errorCode: null, message: null };
}

function emptyMeta(): ReentrySectionMeta {
  return { status: "EMPTY", observedAt: null, errorCode: null, message: null };
}

function failedMeta(error: unknown): ReentrySectionMeta {
  return {
    status: "FAILED",
    observedAt: null,
    errorCode: error instanceof AppError ? error.code : "REENTRY_SECTION_FAILED",
    message: error instanceof Error ? error.message : "该部分数据暂时不可用",
  };
}

/**
 * 60 秒再入场：只读聚合，不另存项目事实。
 * 局部子服务失败不伪造空项目：对应部分返回 FAILED 并保留错误码。
 */
export async function getProjectReentry(projectId: string): Promise<ReentryData> {
  ensureReentryEnabled();
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, title: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);

  // ---- 检查点与其后变化 ----
  let episode: ReentryEpisodePart = {
    episodeId: null,
    revisionId: null,
    title: null,
    confirmedAt: null,
    status: null,
    changesSince: [],
    meta: emptyMeta(),
  };
  let episodeFreshness: string = "FRESH";
  try {
    const latest = await getLatestPublishedEpisode(projectId);
    if (!latest) {
      episode.meta = emptyMeta();
    } else {
      const revision = latest.revisions[latest.revisions.length - 1];
      episode = {
        episodeId: latest.id,
        revisionId: revision?.id ?? null,
        title: latest.title,
        confirmedAt: revision?.createdAt ?? null,
        status: latest.status,
        changesSince: [],
        meta: okMeta(latest.updatedAt),
      };
      episodeFreshness = latest.status ?? "PUBLISHED";
      if (revision?.endSnapshotId) {
        const endSnapshot = await getLatestProjectState(projectId).catch(() => null);
        if (endSnapshot && endSnapshot.id !== revision.endSnapshotId) {
          const diff = await getProjectStateDiff(projectId, revision.endSnapshotId, endSnapshot.id);
          episode.changesSince = diff.items
            .slice(0, 3)
            .map((item) => item.summary);
        }
      }
    }
  } catch (error) {
    episode.meta = failedMeta(error);
  }

  // ---- 最大风险或未知 ----
  let risk: ReentryRiskPart = { text: null, severity: null, entityId: null, meta: emptyMeta() };
  try {
    const snapshot = await getLatestProjectState(projectId).catch(() => null);
    if (!snapshot) {
      risk.meta = emptyMeta();
    } else {
      const payload = snapshot.payload;
      const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
      const topRisk = [...payload.risks].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity])[0];
      const unknown = payload.unknowns[0];
      if (topRisk) {
        risk = { text: topRisk.text, severity: topRisk.severity, entityId: topRisk.stableKey, meta: okMeta(snapshot.evaluatedAt) };
      } else if (unknown) {
        risk = { text: unknown.text, severity: null, entityId: null, meta: okMeta(snapshot.evaluatedAt) };
      } else {
        risk.meta = emptyMeta();
      }
    }
  } catch (error) {
    risk.meta = failedMeta(error);
  }

  // ---- 最近一个已确认且尚未完成的安排 ----
  let schedule: ReentrySchedulePart = {
    planId: null,
    blockId: null,
    actionId: null,
    actionTitle: null,
    start: null,
    end: null,
    meta: emptyMeta(),
  };
  try {
    const plan = await getCurrentSchedulePlan(projectId).catch(() => null);
    const now = new Date();
    const upcoming = plan?.blocks
      .filter((block) => new Date(block.end).getTime() >= now.getTime())
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    if (plan && upcoming) {
      schedule = {
        planId: plan.id,
        blockId: upcoming.id,
        actionId: upcoming.actionId,
        actionTitle: upcoming.actionTitle,
        start: upcoming.start,
        end: upcoming.end,
        meta: okMeta(plan.updatedAt),
      };
    } else {
      schedule.meta = emptyMeta();
    }
  } catch (error) {
    schedule.meta = failedMeta(error);
  }

  // ---- 主操作：先看变化，再解阻塞，再开始行动 ----
  let primaryAction: ReentryPrimaryAction = "START_ACTION";
  let primaryMessage = "从检查点选择下一步行动";
  if (episode.meta.status === "FAILED") {
    primaryAction = "VIEW_CHANGES";
    primaryMessage = "检查点数据暂时不可用，请稍后重试";
  } else if (episodeFreshness === "STALE" || episodeFreshness === "PARTIALLY_STALE") {
    primaryAction = "VIEW_CHANGES";
    primaryMessage = "部分结论的来源已变化，请先查看受影响的内容";
  } else if (schedule.meta.status === "EMPTY" || !schedule.blockId) {
    primaryAction = "START_ACTION";
    primaryMessage = episode.episodeId ? "从检查点选择下一步，并安排到未来时间" : "先整理一次阶段进展，再选择下一步";
  } else {
    primaryAction = "START_ACTION";
    primaryMessage = schedule.actionTitle ? `继续推进：${schedule.actionTitle}` : "继续推进已安排的行动";
  }

  return {
    projectId: project.id,
    projectName: project.title,
    freshness: "FRESH",
    episode,
    risk,
    schedule,
    primaryAction,
    primaryMessage,
    generatedAt: new Date().toISOString(),
  };
}
