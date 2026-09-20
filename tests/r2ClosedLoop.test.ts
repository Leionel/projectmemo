process.env.PROJECT_EPISODES_ENABLED = "1";
process.env.PROJECT_SCHEDULING_ENABLED = "1";
process.env.PROJECT_REENTRY_ENABLED = "1";
process.env.PROJECT_STATE_ENABLED = "1";
process.env.TEMPORAL_MEMORY_ENABLED = "1";

import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";
import { processCaptureWithRequest } from "@/lib/services/captureService";
import { previewProjectEpisode, confirmEpisodeRevision, getProjectEpisode, refreshProjectEpisode } from "@/lib/services/projectEpisodeService";
import { updateActionFeasibilityInput } from "@/lib/services/actionFeasibilityService";
import { previewSchedule, confirmSchedulePlan } from "@/lib/services/scheduleService";
import { getProjectReentry } from "@/lib/services/projectReentryService";
import { generateArtifact } from "@/lib/services/artifactService";
import { refreshProjectState } from "@/lib/services/projectStateService";
import { proposeTemporalRelation, confirmRelation } from "@/lib/services/temporalLedgerService";

/**
 * R2 闭环验收：非 seed 项目，从原始记录出发走完
 * 来源 → 检查点 → 防漂移 → 下一行动 → 应用内安排 → 再入场 → 成果范围。
 */
describe("R2 closed loop on a non-seed project", () => {
  const createdProjectIds: string[] = [];
  const createdUserIds: string[] = [];

  afterAll(async () => {
    for (const id of createdProjectIds) await db.project.delete({ where: { id } }).catch(() => {});
    for (const id of createdUserIds) await db.user.delete({ where: { id } }).catch(() => {});
  });

  async function buildProject() {
    const project = await db.project.create({
      data: {
        title: `闭环验收-${Date.now()}`,
        description: "通过真实服务调用产生的非 seed 项目",
        goal: "验证 R2 全链路",
        scenario: "RESEARCH",
      },
    });
    createdProjectIds.push(project.id);
    const user = await db.user.create({
      data: { username: `loop-${Date.now()}`, displayName: "闭环验收用户", passwordHash: "x" },
    });
    createdUserIds.push(user.id);
    await db.projectMembership.create({ data: { userId: user.id, projectId: project.id, role: "OWNER" } });
    return { project, user };
  }

  it("walks capture → checkpoint → drift → schedule → reentry → artifact", async () => {
    const { project, user } = await buildProject();

    // ---- 1. 原始记录进入时态账本 ----
    const captureA = await processCaptureWithRequest(project.id, "实验记录：模型召回率提升到 78%，切片粒度调优有效", "实验记录", { requestId: "loop-a" });
    const captureB = await processCaptureWithRequest(project.id, "老师建议：先聚焦召回指标，暂时忽略延迟优化", "会议记录", { requestId: "loop-b" });
    await refreshProjectState(project.id).catch(() => {});
    expect(captureA.card).toBeTruthy();
    expect(captureB.card).toBeTruthy();

    // ---- 2. 阶段检查点：预览 → 来源可见 → 确认 ----
    const preview = await previewProjectEpisode(project.id, {
      windowStart: new Date(Date.now() - 60_000).toISOString(),
      windowEnd: new Date().toISOString(),
    });
    const revision = preview.episode.revisions[0];
    const factClaims = revision.claims.filter((claim) => claim.kind === "FACT" && claim.section === "CONFIRMED_CHANGES");
    expect(factClaims.length).toBeGreaterThanOrEqual(2);
    for (const claim of factClaims) expect(claim.sourceRefIds.length).toBeGreaterThan(0);

    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: revision.revision,
      requestId: "loop-confirm-1",
      expectedSourceHash: revision.sourceHash,
    });

    // ---- 3. 防漂移：新记录取代旧结论，受影响 claim 被定位 ----
    const captureC = await processCaptureWithRequest(project.id, "新实验结论：切片粒度调优被更大窗口方案取代", "实验记录", { requestId: "loop-c" });
    const older = captureA.card!;
    const newer = captureC.card!;
    const relation = await proposeTemporalRelation(project.id, newer.id, {
      relatedCardId: older.id,
      relationType: "SUPERSEDES",
      reason: "更大窗口方案效果更好",
    });
    await confirmRelation(project.id, relation.id);

    const detail = await getProjectEpisode(project.id, preview.episode.id);
    expect(["PARTIALLY_STALE", "STALE"]).toContain(detail.status);
    const supersededClaim = detail.revisions[0].claims.find((claim) => claim.text.includes("召回率提升"));
    expect(supersededClaim).toBeTruthy();
    expect(detail.freshness!.affectedClaims.some((item) => item.claimId === supersededClaim!.claimId)).toBe(true);

    // ---- 4. 刷新生成新修订，旧版保留 ----
    const refreshed = await refreshProjectEpisode(project.id, preview.episode.id);
    expect(refreshed.revisions).toHaveLength(2);
    await confirmEpisodeRevision(project.id, preview.episode.id, {
      revision: 2,
      requestId: "loop-confirm-2",
      expectedSourceHash: refreshed.revisions[1].sourceHash,
    });

    // ---- 5. 行动：创建 → 补估时 → READY ----
    const action = await db.actionItem.create({
      data: { projectId: project.id, title: "跑更大窗口对比实验", priority: 1, status: "TODO" },
    });
    await updateActionFeasibilityInput(project.id, { actionId: action.id, estimatedMinutes: 90 });

    // ---- 6. 应用内安排：预览 → 确认 → 不改变 TODO ----
    const HOUR = 3_600_000;
    const base = Date.now() + 24 * HOUR;
    const plan = await previewSchedule(project.id, {
      requestId: `loop-plan-${project.id}`,
      rangeStart: new Date(base).toISOString(),
      rangeEnd: new Date(base + 8 * HOUR).toISOString(),
      slots: [{ start: new Date(base).toISOString(), end: new Date(base + 8 * HOUR).toISOString() }],
      actionIds: [action.id],
    }, { userId: user.id });
    expect(plan.blocks).toHaveLength(1);
    const confirmedPlan = await confirmSchedulePlan(project.id, plan.id, { requestId: `loop-plan-${project.id}` }, { userId: user.id });
    expect(confirmedPlan.status).toBe("CONFIRMED");
    const actionAfterSchedule = await db.actionItem.findUniqueOrThrow({ where: { id: action.id } });
    expect(actionAfterSchedule.status).toBe("TODO");

    // ---- 7. 60 秒再入场：检查点 + 风险 + 下一安排 + 主操作 ----
    const reentry = await getProjectReentry(project.id);
    expect(reentry.episode.episodeId).toBe(preview.episode.id);
    expect(reentry.episode.meta.status).toBe("OK");
    expect(reentry.schedule.actionId).toBe(action.id);
    expect(reentry.primaryAction).toBe("START_ACTION");

    // ---- 8. 成果联动：以检查点为范围生成，sourceRefs 只含检查点冻结来源 ----
    const artifact = await generateArtifact(project.id, "weekly_report", { episodeId: preview.episode.id });
    expect(artifact.id).toBeTruthy();
    const refs = artifact.sourceRefs as Array<{ cardId: string; observedAt: string }>;
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every((ref) => ref.observedAt)).toBe(true);
  });
});
