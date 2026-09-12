import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  assessActionFeasibility,
  updateActionFeasibilityInput,
} from "@/lib/services/actionFeasibilityService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";

describe("Action feasibility (F1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "行动可行性测试项目",
        description: "验证 READY/BLOCKED/UNKNOWN 三态与依赖边界",
        goal: "F1 验收",
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

  async function seedAction(title: string, overrides: { status?: string; dueAt?: Date } = {}) {
    return db.actionItem.create({
      data: {
        projectId,
        title,
        status: (overrides.status ?? "TODO") as never,
        priority: 2,
        dueAt: overrides.dueAt ?? null,
      },
    });
  }

  it("reports no-dependency actions as READY with an explicit unestimated note", async () => {
    const action = await seedAction("撰写演示脚本");
    const assessment = await assessActionFeasibility(projectId, action.id);
    expect(assessment.feasibility).toBe("READY");
    expect(assessment.estimateMinutes).toBeNull();
    expect(assessment.estimateNote).toContain("未估算");
    expect(assessment.overdue).toBe(false);
  });

  it("blocks on incomplete or cancelled hard action dependencies and clears when done", async () => {
    const depAction = await seedAction("准备实验数据");
    const action = await seedAction("撰写结果分析");

    await updateActionFeasibilityInput(projectId, {
      actionId: action.id,
      addRequirements: [{ targetKind: "action", targetId: depAction.id, hard: true }],
    });

    const blocked = await assessActionFeasibility(projectId, action.id);
    expect(blocked.feasibility).toBe("BLOCKED");
    expect(blocked.dependencies[0].note).toContain("尚未完成");

    await db.actionItem.update({ where: { id: depAction.id }, data: { status: "CANCELLED" } });
    const cancelled = await assessActionFeasibility(projectId, action.id);
    expect(cancelled.feasibility).toBe("BLOCKED");
    expect(cancelled.dependencies[0].note).toContain("已取消");

    await db.actionItem.update({ where: { id: depAction.id }, data: { status: "DONE", completedAt: new Date() } });
    const ready = await assessActionFeasibility(projectId, action.id);
    expect(ready.feasibility).toBe("READY");
  });

  it("treats a superseded supporting record as an unmet dependency", async () => {
    const card = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "支撑记录：采用方案A", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "选型方案A：基础版本",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const action = await seedAction("基于方案A开展测试");
    await updateActionFeasibilityInput(projectId, {
      actionId: action.id,
      addRequirements: [{ targetKind: "card", targetId: card.id }],
    });

    // 未确认的独立事实：证据不足，不得兜底为 MET
    const unevaluated = await assessActionFeasibility(projectId, action.id);
    expect(unevaluated.feasibility).toBe("UNKNOWN");
    expect(unevaluated.dependencies[0].note).toContain("证据不足");

    // 有确认的支持关系后才视为满足
    const supporter = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "支撑来源", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "支撑来源记录",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const supportRelation = await db.cardRelation.create({
      data: {
        currentCardId: supporter.id,
        relatedCardId: card.id,
        relationType: "SUPPORTS",
        reason: "实验支撑",
        score: 80,
        confirmed: true,
        confirmedAt: new Date(),
      },
    });
    const ready = await assessActionFeasibility(projectId, action.id);
    expect(ready.feasibility).toBe("READY");

    const proposal = await analyzeChangeImpact(projectId, "选型方案A：基础版本改为方案B");
    await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "选型方案A：基础版本改为方案B",
      supersededCardId: proposal.supersededCardId,
    });

    const blocked = await assessActionFeasibility(projectId, action.id);
    expect(blocked.feasibility).toBe("BLOCKED");
    expect(blocked.dependencies[0].note).toContain("取代");
  });

  it("revoked support no longer satisfies a hard dependency", async () => {
    const depCard = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "被依赖记录", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "被依赖的结论记录",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const other = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "另一条记录", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "另一条记录",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const relation = await db.cardRelation.create({
      data: {
        currentCardId: other.id,
        relatedCardId: depCard.id,
        relationType: "SUPPORTS",
        reason: "支撑",
        score: 80,
        confirmed: true,
        confirmedAt: new Date(),
      },
    });

    const action = await seedAction("依赖可撤销记录");
    await updateActionFeasibilityInput(projectId, {
      actionId: action.id,
      addRequirements: [{ targetKind: "card", targetId: depCard.id }],
    });
    expect((await assessActionFeasibility(projectId, action.id)).feasibility).toBe("READY");

    await db.cardRelation.update({ where: { id: relation.id }, data: { revokedAt: new Date() } });
    const after = await assessActionFeasibility(projectId, action.id);
    expect(after.feasibility).toBe("BLOCKED");
    expect(after.dependencies[0].state).toBe("UNMET");
    expect(after.dependencies[0].note).toContain("撤销");
  });

  it("marks pending-card dependencies as UNKNOWN instead of READY", async () => {
    const card = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "待确认记录", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "待确认：评审结论",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const related = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "相关记录", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "相关记录",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    await db.cardRelation.create({
      data: {
        currentCardId: related.id,
        relatedCardId: card.id,
        relationType: "SUPPORTS",
        reason: "待确认",
        score: 60,
      },
    });

    const action = await seedAction("跟进评审结论");
    await updateActionFeasibilityInput(projectId, {
      actionId: action.id,
      addRequirements: [{ targetKind: "card", targetId: card.id }],
    });
    const assessment = await assessActionFeasibility(projectId, action.id);
    expect(assessment.feasibility).toBe("UNKNOWN");
  });

  it("rejects cross-project references, self dependency and cycles", async () => {
    const other = await db.project.create({
      data: { title: "可行性外部项目", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const foreignAction = await db.actionItem.create({
        data: { projectId: other.id, title: "外部行动", status: "TODO", priority: 3 },
      });
      const action = await seedAction("本地行动");
      await expect(
        updateActionFeasibilityInput(projectId, {
          actionId: action.id,
          addRequirements: [{ targetKind: "action", targetId: foreignAction.id }],
        }),
      ).rejects.toThrow();

      await expect(
        updateActionFeasibilityInput(projectId, {
          actionId: action.id,
          addRequirements: [{ targetKind: "action", targetId: action.id }],
        }),
      ).rejects.toThrow();

      const depA = await seedAction("依赖A");
      const depB = await seedAction("依赖B");
      await updateActionFeasibilityInput(projectId, {
        actionId: depA.id,
        addRequirements: [{ targetKind: "action", targetId: depB.id }],
      });
      await expect(
        updateActionFeasibilityInput(projectId, {
          actionId: depB.id,
          addRequirements: [{ targetKind: "action", targetId: depA.id }],
        }),
      ).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: other.id } }).catch(() => {});
    }
  });

  it("a lifecycle source confirmation does not upgrade an unconfirmed dependency", async () => {
    const { confirmCardFact } = await import("@/lib/services/memoryLifecycleService");
    const card = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: (await db.capture.create({
          data: { projectId, rawText: "仅人工确认的记录", sourceType: "测试" },
        })).id,
        type: "meeting_note",
        title: "仅人工确认的记录",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
    const action = await seedAction("依赖仅人工确认的记录");
    await updateActionFeasibilityInput(projectId, {
      actionId: action.id,
      addRequirements: [{ targetKind: "card", targetId: card.id }],
    });

    // 人工确认是来源声明：不虚构 SUPPORTS，可行性保持 UNKNOWN
    await confirmCardFact(projectId, card.id, { reason: "已核对" });
    const assessment = await assessActionFeasibility(projectId, action.id);
    expect(assessment.feasibility).toBe("UNKNOWN");
  });

  it("flags overdue deadlines and keeps user estimates honest", async () => {
    const action = await seedAction("已过期任务", { dueAt: new Date(Date.now() - 86400000) });
    await updateActionFeasibilityInput(projectId, { actionId: action.id, estimatedMinutes: 45 });
    const assessment = await assessActionFeasibility(projectId, action.id);
    expect(assessment.overdue).toBe(true);
    expect(assessment.estimateMinutes).toBe(45);

    await expect(
      updateActionFeasibilityInput(projectId, { actionId: action.id, estimatedMinutes: 0 }),
    ).rejects.toThrow();

    const bare = await seedAction("未估算任务");
    const bareAssessment = await assessActionFeasibility(projectId, bare.id);
    expect(bareAssessment.estimateMinutes).toBeNull();
    expect(bareAssessment.estimateNote).toContain("未估算");
  });
});
