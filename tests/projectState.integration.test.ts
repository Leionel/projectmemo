process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PROJECT_STATE_SCHEMA_VERSION } from "@/lib/types/projectState";
import { db } from "@/lib/db";
import {
  checkInProjectState,
  getLatestProjectState,
  getProjectStateFreshness,
  getProjectStateDiff,
  refreshProjectState,
} from "@/lib/services/projectStateService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";
import { completeProjectAction } from "@/lib/services/actionService";
import { updateProject } from "@/lib/repositories/projects";
import { createProjectMilestone, confirmDeliverableEvidence } from "@/lib/services/milestoneService";
import { proposeTemporalRelation } from "@/lib/services/temporalLedgerService";

process.env.PROJECT_STATE_ENABLED = "1";

describe("Project state snapshot / diff (R2 integration)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "状态快照集成测试项目",
        description: "验证数据库→服务→快照→Diff 闭环",
        goal: "R2 验收",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  async function seedCard(title: string, targetProjectId = projectId) {
    const capture = await db.capture.create({
      data: { projectId: targetProjectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId: targetProjectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: `${title} 摘要`,
        keywords: ["测试"],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
  }

  it("returns EMPTY before any refresh and does not implicitly generate", async () => {
    const latest = await getLatestProjectState(projectId);
    expect(latest).toBeNull();
  });

  it("creates a baseline on first refresh and reuses on unchanged refresh", async () => {
    const card = await seedCard("决策：采用方案A作为基线");
    void card;

    const first = await refreshProjectState(projectId);
    expect(first.baselineCreated).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.reused).toBe(false);
    expect(first.snapshot.payload.snapshotId).toBe(first.snapshot.id);

    const second = await refreshProjectState(projectId);
    expect(second.reused).toBe(true);
    expect(second.changed).toBe(false);
    expect(second.snapshot.id).toBe(first.snapshot.id);

    const viaGet = await getLatestProjectState(projectId);
    expect(viaGet?.id).toBe(first.snapshot.id);
    const freshness = await getProjectStateFreshness(projectId);
    expect(freshness.status).toBe("FRESH");
    expect(freshness.snapshotId).toBe(first.snapshot.id);
  });

  it("retains the previous snapshot and records FAILED freshness when refresh fails", async () => {
    const project = await db.project.create({
      data: { title: "刷新失败保留快照", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const baseline = await refreshProjectState(project.id);
      const prismaForTest = db as unknown as { $transaction: (...args: unknown[]) => Promise<unknown> };
      const transaction = vi.spyOn(prismaForTest, "$transaction").mockRejectedValueOnce(new Error("simulated refresh failure"));
      try {
        await expect(refreshProjectState(project.id)).rejects.toMatchObject({ code: "STATE_REFRESH_FAILED" });
      } finally {
        transaction.mockRestore();
      }
      expect((await getLatestProjectState(project.id))?.id).toBe(baseline.snapshot.id);
      const freshness = await getProjectStateFreshness(project.id);
      expect(freshness.status).toBe("FAILED");
      expect(freshness.snapshotId).toBe(baseline.snapshot.id);
      expect(freshness.errorMessage).toContain("状态刷新失败");
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("concurrent identical refreshes converge on a single new snapshot", async () => {
    const project = await db.project.create({
      data: { title: "并发刷新测试项目", description: "", goal: "并发", scenario: "COMPETITION" },
    });
    try {
      const [r1, r2] = await Promise.all([
        refreshProjectState(project.id),
        refreshProjectState(project.id),
      ]);
      expect(r1.snapshot.id).toBe(r2.snapshot.id);
      const rows = await db.projectStateSnapshot.count({ where: { projectId: project.id } });
      expect(rows).toBe(1);
      expect(r1.snapshot.id).toBe((await getLatestProjectState(project.id))?.id);
      const checkIn = await checkInProjectState(project.id, {
        displayedSnapshotId: r1.snapshot.id,
        consumerKey: "concurrent-device",
      });
      expect(checkIn.status).toBe("OK");
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("diff across policy versions demands a rebuild instead of faking consistency", async () => {
    const project = await db.project.create({
      data: { title: "规则版本测试项目", description: "", goal: "G", scenario: "COMPETITION" },
    });
    try {
      const baseline = await refreshProjectState(project.id);
      const legacy = await db.projectStateSnapshot.create({
        data: {
          projectId: project.id,
          sequence: baseline.snapshot.sequence + 1000,
          schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
          policyVersion: "1",
          sourceHash: "legacy",
          evaluationKey: "phase:steady",
          contentHash: "legacy",
          observedAt: new Date(),
          evaluatedAt: new Date(),
          payload: baseline.snapshot.payload as unknown as object,
        },
      });
      await expect(
        getProjectStateDiff(project.id, legacy.id, baseline.snapshot.id),
      ).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("confirm reports stateRefreshPending when state feature is disabled", async () => {
    const card = await seedCard("待刷新标记测试卡");
    void card;
    const previous = process.env.PROJECT_STATE_ENABLED;
    process.env.PROJECT_STATE_ENABLED = "0";
    try {
      const proposal = await analyzeChangeImpact(projectId, "待刷新标记测试卡改为待刷新标记方案B");
      const confirmed = await confirmChangeImpact(projectId, {
        proposalId: proposal.proposalId,
        newFactText: "待刷新标记测试卡改为待刷新标记方案B",
        supersededCardId: proposal.supersededCardId,
      });
      expect(confirmed.success).toBe(true);
      expect((confirmed as { stateRefreshPending?: boolean }).stateRefreshPending).toBe(true);
    } finally {
      process.env.PROJECT_STATE_ENABLED = previous ?? "1";
    }
  });

  it("field round-trip A→B→A creates a new snapshot and latest returns to A", async () => {
    const project = await db.project.create({
      data: { title: "字段往返测试项目", description: "", goal: "A", scenario: "COMPETITION" },
    });
    try {
      const s1 = await refreshProjectState(project.id);
      expect(s1.snapshot.payload.goal).toBe("A");

      await db.project.update({ where: { id: project.id }, data: { goal: "B" } });
      const s2 = await refreshProjectState(project.id);
      expect(s2.snapshot.payload.goal).toBe("B");

      await db.project.update({ where: { id: project.id }, data: { goal: "A" } });
      const s3 = await refreshProjectState(project.id);
      // 回到旧字段值也必须产生新的状态记录，不得复用第一次 A 的历史行
      expect(s3.reused).toBe(false);
      expect(s3.snapshot.id).not.toBe(s1.snapshot.id);
      expect(s3.snapshot.previousSnapshotId).toBe(s2.snapshot.id);

      const latest = await getLatestProjectState(project.id);
      expect(latest?.id).toBe(s3.snapshot.id);
      expect(latest?.payload.goal).toBe("A");

      const diff = await getProjectStateDiff(project.id, s2.snapshot.id, s3.snapshot.id);
      expect(diff.materialChange).toBe(true);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("refreshes after project settings and deliverable evidence mutations", async () => {
    const project = await db.project.create({
      data: { title: "业务事实刷新测试", description: "", goal: "旧目标", scenario: "COMPETITION" },
    });
    try {
      const baseline = await refreshProjectState(project.id);
      const updated = await updateProject(project.id, { goal: "新目标" });
      expect(updated.stateRefreshPending).toBe(false);
      const afterProject = await getLatestProjectState(project.id);
      expect(afterProject?.payload.goal).toBe("新目标");
      expect(afterProject?.id).not.toBe(baseline.snapshot.id);

      const card = await seedCard("刷新用实验记录", project.id);
      const milestone = await createProjectMilestone({
        projectId: project.id,
        title: "刷新用里程碑",
        deliverables: [{ title: "实验记录", expectedEvidence: ["experiment_log"] }],
      });
      const deliverable = milestone.deliverables[0];
      const evidence = await confirmDeliverableEvidence({
        projectId: project.id,
        deliverableId: deliverable.id,
        evidenceType: "experiment_log",
        cardId: card.id,
        confirmed: true,
      });
      expect(evidence.stateRefreshPending).toBe(false);
      const afterEvidence = await getLatestProjectState(project.id);
      expect(afterEvidence?.payload.gaps.some((gap) => gap.deliverableId === deliverable.id)).toBe(false);

      const older = await seedCard("待确认旧方案", project.id);
      const newer = await seedCard("待确认新方案", project.id);
      const proposed = await proposeTemporalRelation(project.id, newer.id, {
        relatedCardId: older.id,
        relationType: "SUPERSEDES",
        reason: "等待用户确认的替代关系",
      });
      expect(proposed.stateRefreshPending).toBe(false);
      const afterProposal = await getLatestProjectState(project.id);
      expect(afterProposal?.payload.facts.some((fact) => fact.temporalState === "CONTESTED" && fact.truth === "UNKNOWN")).toBe(true);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("detects a decision supersession as a material change with a traceable diff", async () => {
    await seedCard("选型方案A：大型密集模型");
    const baseline = await refreshProjectState(projectId);

    const proposal = await analyzeChangeImpact(projectId, "选型方案A：大型密集模型改为轻量量化方案B");
    const confirmed = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "选型方案A：大型密集模型改为轻量量化方案B",
      supersededCardId: proposal.supersededCardId,
    });
    expect(confirmed.success).toBe(true);

    // 确认变更已补偿性刷新；再刷新应命中最新行复用
    const after = await refreshProjectState(projectId);
    expect(after.snapshot.previousSnapshotId).toBe(baseline.snapshot.id);
    expect(after.snapshot.payload.facts.some((fact) => fact.text.includes("取代"))).toBe(true);

    const diff = await getProjectStateDiff(projectId, baseline.snapshot.id, after.snapshot.id);
    expect(diff.materialChange).toBe(true);
    const supersededItem = diff.items.find((item) => item.changeKey.endsWith(":validity") && item.kind === "CHANGED");
    expect(supersededItem).toBeDefined();
    expect(supersededItem?.summary).toContain("取代");
    // 每条变化必须携带证据引用
    expect(supersededItem?.evidenceRefs.length).toBeGreaterThan(0);
    expect(supersededItem?.evidenceRefs[0].entityId).toBe(proposal.supersededCardId);

    // 无变化刷新不会重复产生新快照行
    const noChangeRefresh = await refreshProjectState(projectId);
    expect(noChangeRefresh.reused).toBe(true);
  });

  it("detects action completion as a resolved change", async () => {
    const card = await seedCard("行动卡：运行消融实验");
    const action = await db.actionItem.create({
      data: { projectId, sourceCardId: card.id, title: "运行消融实验", status: "TODO", priority: 2 },
    });
    const baseline = await refreshProjectState(projectId);

    const completion = await completeProjectAction(projectId, action.id, "消融实验完成，结果符合预期");
    expect(completion.status).toBe("DONE");
    expect(completion.stateRefreshPending).toBe(false);

    const after = await refreshProjectState(projectId);
    // 行动完成已经在业务提交后触发补偿刷新；显式刷新只复用这份最新快照。
    expect(after.reused).toBe(true);

    const diff = await getProjectStateDiff(projectId, baseline.snapshot.id, after.snapshot.id);
    const actionItem = diff.items.find((item) => item.changeKey === `action:${action.id}:status`);
    expect(actionItem?.kind).toBe("RESOLVED");
    expect(actionItem?.summary).toContain("已记录为完成");
  });

  it("preserves A→B→A recurrence as separate snapshot rows", async () => {
    const cardA = await seedCard("往返方案A：基础版本");
    void cardA;
    const baseline = await refreshProjectState(projectId);

    const toB = await analyzeChangeImpact(projectId, "往返方案A：基础版本改为往返方案B");
    await confirmChangeImpact(projectId, {
      proposalId: toB.proposalId,
      newFactText: "往返方案A：基础版本改为往返方案B",
      supersededCardId: toB.supersededCardId,
    });
    const stateB = await refreshProjectState(projectId);

    const backToA = await analyzeChangeImpact(projectId, "往返方案B再次替换为往返方案A：基础版本");
    const confirmedBack = await confirmChangeImpact(projectId, {
      proposalId: backToA.proposalId,
      newFactText: "往返方案B再次替换为往返方案A：基础版本",
      supersededCardId: backToA.supersededCardId,
    });
    expect(confirmedBack.success).toBe(true);
    // 确认已补偿刷新出"回到 A"的新快照行（不复用任何历史行）
    const latestA = await getLatestProjectState(projectId);
    expect(latestA).not.toBeNull();
    expect(latestA!.previousSnapshotId).toBe(stateB.snapshot.id);
    const diff = await getProjectStateDiff(projectId, stateB.snapshot.id, latestA!.id);
    expect(diff.materialChange).toBe(true);
  });

  it("refuses diff across projects", async () => {
    const other = await db.project.create({
      data: { title: "快照越界项目", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const mine = await refreshProjectState(projectId);
      const theirs = await refreshProjectState(other.id);
      await expect(getProjectStateDiff(projectId, mine.snapshot.id, theirs.snapshot.id)).rejects.toThrow();
      await expect(getProjectStateDiff(projectId, theirs.snapshot.id, mine.snapshot.id)).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it("check-in advances the cursor and never regresses", async () => {
    const consumerKey = "device-test-1";
    const first = await refreshProjectState(projectId);
    const checkIn = await checkInProjectState(projectId, {
      displayedSnapshotId: first.snapshot.id,
      consumerKey,
    });
    expect(checkIn.status).toBe("OK");

    // 重复 check-in 同一快照 → ALREADY_SEEN
    const repeat = await checkInProjectState(projectId, {
      displayedSnapshotId: first.snapshot.id,
      consumerKey,
    });
    expect(repeat.status).toBe("ALREADY_SEEN");

    // 生成新变化后推进
    const card = await seedCard("推进游标的新决策");
    void card;
    const second = await refreshProjectState(projectId);
    if (second.snapshot.id !== first.snapshot.id) {
      const advance = await checkInProjectState(projectId, {
        displayedSnapshotId: second.snapshot.id,
        consumerKey,
      });
      expect(advance.status).toBe("OK");

      // 旧快照不能让游标倒退
      const regress = await checkInProjectState(projectId, {
        displayedSnapshotId: first.snapshot.id,
        consumerKey,
      });
      expect(regress.status).toBe("ALREADY_SEEN");
      expect(regress.lastSeenSnapshotId).toBe(second.snapshot.id);
    }
  });
});
