process.env.PROJECT_REENTRY_ENABLED = "1";
process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_SCHEDULING_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { getProjectReentry } from "@/lib/services/projectReentryService";
import { previewProjectEpisode, confirmEpisodeRevision } from "@/lib/services/projectEpisodeService";
import { previewSchedule, confirmSchedulePlan } from "@/lib/services/scheduleService";
import { proposeTemporalRelation, confirmRelation } from "@/lib/services/temporalLedgerService";
import { refreshProjectState } from "@/lib/services/projectStateService";

const createdProjectIds: string[] = [];
const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdProjectIds) {
    await db.project.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdUserIds) {
    await db.user.delete({ where: { id } }).catch(() => {});
  }
});

async function newProject(title: string) {
  const project = await db.project.create({
    data: { title, description: "再入场测试", goal: "R2-4 验收", scenario: "COMPETITION" },
  });
  createdProjectIds.push(project.id);
  return project;
}

async function seedCard(projectId: string, title: string) {
  const capture = await db.capture.create({ data: { projectId, rawText: title, sourceType: "测试" } });
  return db.knowledgeCard.create({
    data: {
      projectId,
      captureId: capture.id,
      type: "meeting_note",
      title,
      summary: `${title} 摘要`,
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance: 3,
    },
  });
}

async function seedUser(projectId: string) {
  const user = await db.user.create({
    data: { username: `reentry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, displayName: "再入场测试用户", passwordHash: "x" },
  });
  createdUserIds.push(user.id);
  await db.projectMembership.create({ data: { userId: user.id, projectId, role: "OWNER" } });
  return user;
}

const HOUR = 3_600_000;

describe("ProjectReentry aggregation (R2-4)", () => {
  it("returns structured empty sections for a fresh project without fabricating progress", async () => {
    const project = await newProject("空项目再入场");
    const reentry = await getProjectReentry(project.id);
    expect(reentry.projectId).toBe(project.id);
    expect(reentry.episode.meta.status).toBe("EMPTY");
    expect(reentry.episode.changesSince).toEqual([]);
    expect(reentry.risk.text).toBeNull();
    expect(reentry.schedule.meta.status).toBe("EMPTY");
    expect(reentry.primaryMessage).toContain("阶段进展");
    // 顶层新鲜度不写死：全空时是 EMPTY
    expect(reentry.freshness).toBe("EMPTY");
    expect(reentry.primaryAction).toBe("ADD_EVIDENCE");
  });

  it("aggregates confirmed episode, risk, and confirmed schedule into one result", async () => {
    const project = await newProject("完整链路再入场");
    const user = await seedUser(project.id);
    await seedCard(project.id, "关键决策：采用方案A");
    await refreshProjectState(project.id).catch(() => {});

    const preview = await previewProjectEpisode(project.id, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: preview.episode.revisions[0].revision,
      requestId: `reentry-episode-${preview.episode.id}`,
    });

    const action = await db.actionItem.create({
      data: { projectId: project.id, title: "下一步：实现原型", priority: 1, status: "TODO", estimatedMinutes: 60 },
    });
    const base = Date.now() + 48 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `reentry-plan-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
    }, { userId: user.id });
    await confirmSchedulePlan(project.id, plan.id, { requestId: `reentry-plan-${project.id}` }, { userId: user.id });

    const reentry = await getProjectReentry(project.id);
    expect(reentry.episode.episodeId).toBe(preview.episode.id);
    expect(reentry.episode.meta.status).toBe("OK");
    expect(reentry.schedule.actionId).toBe(action.id);
    expect(reentry.primaryAction).toBe("START_ACTION");
    expect(reentry.primaryMessage).toContain("实现原型");
    // 子状态全部可用时才是 FRESH；版本号与来源数随聚合返回
    expect(reentry.freshness).toBe("FRESH");
    expect(reentry.episode.revision).toBe(1);
    expect(reentry.episode.sourceCount).toBeGreaterThan(0);
    expect(reentry.schedule.calendarStatus).toBe("NONE");
    void plan;
  });

  it("reports STALE when a cited source is superseded but keeps other sections usable", async () => {
    const project = await newProject("局部失效再入场");
    const user = await seedUser(project.id);
    const older = await seedCard(project.id, "会被取代的阶段结论");
    await refreshProjectState(project.id).catch(() => {});
    const preview = await previewProjectEpisode(project.id, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: preview.episode.revisions[0].revision,
      requestId: `stale-${preview.episode.id}`,
    });

    const newer = await seedCard(project.id, "取代旧结论的新证据");
    const relation = await proposeTemporalRelation(project.id, newer.id, {
      relatedCardId: older.id,
      relationType: "SUPERSEDES",
      reason: "复测结果更新",
    });
    await confirmRelation(project.id, relation.id);

    const reentry = await getProjectReentry(project.id, user.id);
    expect(reentry.freshness).toBe("STALE");
    expect(reentry.episode.status).toBe("PARTIALLY_STALE");
    expect(reentry.primaryAction).toBe("VIEW_CHANGES");
    // 局部失效不影响其余子服务：风险与安排仍可用，不伪造空态
    expect(reentry.risk.meta.status).toBe("OK");
    expect(reentry.schedule.meta.status).toBe("EMPTY");
  });

  it("keeps other sections available when the schedule part is disabled", async () => {
    const project = await newProject("局部失败再入场");
    await seedCard(project.id, "风险相关结论");
    await refreshProjectState(project.id).catch(() => {});
    const preview = await previewProjectEpisode(project.id, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: preview.episode.revisions[0].revision,
      requestId: `partial-${preview.episode.id}`,
    });

    const reentry = await getProjectReentry(project.id);
    expect(reentry.episode.episodeId).toBe(preview.episode.id);
    expect(reentry.schedule.meta.status).toBe("EMPTY");
  });
});
