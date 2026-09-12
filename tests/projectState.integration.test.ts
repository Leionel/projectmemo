process.env.PROJECT_STATE_ENABLED = "1";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  checkInProjectState,
  getLatestProjectState,
  getProjectStateDiff,
  refreshProjectState,
} from "@/lib/services/projectStateService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";
import { completeProjectAction } from "@/lib/services/actionService";

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

  async function seedCard(title: string) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
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

    const after = await refreshProjectState(projectId);
    expect(after.reused).toBe(false);
    expect(after.changed).toBe(true);
    expect(after.snapshot.previousSnapshotId).toBe(baseline.snapshot.id);

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

    const after = await refreshProjectState(projectId);
    expect(after.changed).toBe(true);

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
    const stateA2 = await refreshProjectState(projectId);

    expect(stateA2.reused).toBe(false);
    expect(stateA2.snapshot.id).not.toBe(baseline.snapshot.id);
    // 尽管内容与最初 A 状态相似，快照行仍是新增历史，而非复用旧行
    const diff = await getProjectStateDiff(projectId, stateB.snapshot.id, stateA2.snapshot.id);
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
