import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { evaluateTemporalCard } from "@/lib/memory/temporalLedger";
import type { TemporalRelationData } from "@/lib/types";
import {
  applyInterventionPolicy,
  restoreDefaultPolicy,
  updatePolicy,
  type PolicyCandidate,
} from "@/lib/services/interventionPolicyService";
import {
  computeSuggestion,
  recordFeedback,
} from "@/lib/services/interventionFeedbackService";
import { listInterventionDeliveries, recordInterventionDelivery } from "@/lib/services/interventionDeliveryService";
import { acceptIntervention } from "@/lib/repositories/agent";

process.env.INTERVENTION_BUDGET_ENABLED = "1";

function card(id: string, title = id) {
  return { id, title, summary: `${title} 摘要`, createdAt: "2026-09-15T00:00:00.000Z" };
}

function relation(overrides: Partial<TemporalRelationData>): TemporalRelationData {
  return {
    id: "relation-1",
    relationType: "SUPPORTS",
    reason: "测试关系",
    confidence: null,
    confirmed: true,
    confirmedAt: "2026-09-15T00:00:00.000Z",
    revokedAt: null,
    validFrom: null,
    validTo: null,
    createdAt: "2026-09-15T00:00:00.000Z",
    currentCard: card("source"),
    relatedCard: card("target"),
    ...overrides,
  };
}

function candidate(overrides: Partial<PolicyCandidate> = {}): PolicyCandidate {
  return {
    candidateKey: "PROJECT_STALE:phase2",
    triggerType: "PROJECT_STALE",
    dedupeKey: "phase2",
    severity: 3,
    title: "第二阶段测试提醒",
    content: "第二阶段测试内容",
    evidenceFacts: ["测试事实"],
    evidenceCardIds: [],
    evidenceRule: "phase2_test",
    proposedActions: [],
    isSimulated: false,
    ...overrides,
  };
}

describe("ProjectMemo phase 2 acceptance behaviors", () => {
  it("projects detailed temporal outcomes into four top-level states", () => {
    const unknown = evaluateTemporalCard(card("unknown"), [], new Date("2026-09-15T00:00:00.000Z"));
    const current = evaluateTemporalCard(
      card("source"),
      [relation({ currentCard: card("source"), relatedCard: card("evidence") })],
      new Date("2026-09-15T00:00:00.000Z"),
    );
    const superseded = evaluateTemporalCard(
      card("old"),
      [relation({ relationType: "SUPERSEDES", currentCard: card("new"), relatedCard: card("old") })],
      new Date("2026-09-15T00:00:00.000Z"),
    );
    const contested = evaluateTemporalCard(
      card("contested"),
      [relation({ relationType: "CONTRADICTS", currentCard: card("contested"), relatedCard: card("other") })],
      new Date("2026-09-15T00:00:00.000Z"),
    );

    expect((unknown as unknown as { topLevelState: string }).topLevelState).toBe("UNKNOWN");
    expect((current as unknown as { topLevelState: string }).topLevelState).toBe("CURRENT");
    expect((superseded as unknown as { topLevelState: string }).topLevelState).toBe("SUPERSEDED");
    expect((contested as unknown as { topLevelState: string }).topLevelState).toBe("CONTESTED");
    expect((unknown as unknown as { evidenceRefs: unknown[] }).evidenceRefs.length).toBeGreaterThan(0);
  });

  it("keeps an A→B→C chain current only at the frontier and reopens B after B→C is revoked", () => {
    const ab = relation({
      id: "relation-a-b",
      relationType: "SUPERSEDES",
      currentCard: card("b", "方案 B"),
      relatedCard: card("a", "方案 A"),
      createdAt: "2026-09-15T01:00:00.000Z",
      confirmedAt: "2026-09-15T01:00:00.000Z",
    });
    const bc = relation({
      id: "relation-b-c",
      relationType: "SUPERSEDES",
      currentCard: card("c", "方案 C"),
      relatedCard: card("b", "方案 B"),
      createdAt: "2026-09-16T01:00:00.000Z",
      confirmedAt: "2026-09-16T01:00:00.000Z",
    });
    const asOf = new Date("2026-09-20T00:00:00.000Z");
    const chain = [ab, bc];
    expect(evaluateTemporalCard(card("a", "方案 A"), chain, asOf).topLevelState).toBe("SUPERSEDED");
    expect(evaluateTemporalCard(card("b", "方案 B"), chain, asOf).topLevelState).toBe("SUPERSEDED");
    expect(evaluateTemporalCard(card("c", "方案 C"), chain, asOf).topLevelState).toBe("CURRENT");

    const revokedBc = { ...bc, revokedAt: "2026-09-18T01:00:00.000Z", validTo: "2026-09-18T01:00:00.000Z" };
    const reopened = evaluateTemporalCard(card("b", "方案 B"), [ab, revokedBc], asOf);
    expect(reopened.topLevelState).toBe("CURRENT");
    expect(reopened.reasonCode).toBe("ACTIVE_SUPPORT");
  });

  describe.sequential("budget, preference, and feedback closure", () => {
    let projectA = "";
    let projectB = "";

    beforeAll(async () => {
      await restoreDefaultPolicy();
      // 该套件使用持久化的独立 test-vitest.db；清理本套件留下的预算账本，
      // 避免重复运行时把上一次固定测试日期的消耗当成本次并发结果。
      await db.interventionBudgetLedger.deleteMany();
      const [a, b] = await Promise.all([
        db.project.create({ data: { title: "阶段二预算A", description: "", goal: "", scenario: "COMPETITION" } }),
        db.project.create({ data: { title: "阶段二预算B", description: "", goal: "", scenario: "COMPETITION" } }),
      ]);
      projectA = a.id;
      projectB = b.id;
    });

    afterAll(async () => {
      await db.project.delete({ where: { id: projectA } }).catch(() => {});
      await db.project.delete({ where: { id: projectB } }).catch(() => {});
      await restoreDefaultPolicy().catch(() => {});
    });

    it("does not overspend a shared budget under concurrent FIRE decisions", async () => {
      await updatePolicy({ dailyBudget: 1, quietStartMinute: 0, quietEndMinute: 0, timezone: "UTC" });
      const now = new Date("2026-09-20T12:00:00.000Z");
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, (_, index) => applyInterventionPolicy(
          index % 2 === 0 ? projectA : projectB,
          [candidate({
            candidateKey: `RISK_UNHANDLED:concurrent-${index}`,
            triggerType: "RISK_UNHANDLED",
            dedupeKey: `concurrent-${index}`,
          })],
          now,
        )),
      );
      const flat = outcomes.map((items) => items[0]);
      expect(flat.filter((item) => item.decision === "FIRE")).toHaveLength(1);
      expect(flat.filter((item) => item.reasonCode === "BUDGET_EXHAUSTED")).toHaveLength(3);
    });

    it("keeps confirmed topic reduction scoped to its project", async () => {
      await updatePolicy({ dailyBudget: 10, quietStartMinute: 0, quietEndMinute: 0, timezone: "UTC" });
      const { confirmSuggestion, revertTopicReduction } = await import("@/lib/services/interventionFeedbackService");
      await confirmSuggestion(projectA, "PROJECT_STALE");
      try {
        const outcome = await applyInterventionPolicy(
          projectB,
          [candidate({ candidateKey: "PROJECT_STALE:project-b", dedupeKey: "project-b" })],
          new Date("2026-09-21T12:00:00.000Z"),
        );
        expect(outcome[0].decision).toBe("FIRE");
      } finally {
        await revertTopicReduction(projectA, "PROJECT_STALE");
      }
    });

    it("counts only the latest explicit feedback for each intervention", async () => {
      const intervention = await db.agentIntervention.create({
        data: {
          projectId: projectA,
          triggerType: "PROJECT_STALE",
          dedupeKey: "feedback-opposite",
          title: "相反反馈测试",
          content: "",
          evidence: {},
          proposedActions: [],
        },
      });
      await recordFeedback(projectA, intervention.id, { feedbackType: "IGNORED" });
      await recordFeedback(projectA, intervention.id, { feedbackType: "ACCEPTED" });
      const stats = await import("@/lib/services/interventionFeedbackService").then((module) => module.topicFeedbackStats(projectA));
      const stat = stats.find((item) => item.triggerType === "PROJECT_STALE");
      expect(stat?.ignoredCount).toBe(0);
      expect(stat?.acceptedCount).toBe(1);
      expect((await computeSuggestion(projectA)).find((item) => item.triggerType === "PROJECT_STALE")).toBeUndefined();

      const concurrent = await db.agentIntervention.create({
        data: {
          projectId: projectA,
          triggerType: "RISK_UNHANDLED",
          dedupeKey: "feedback-concurrent",
          title: "并发反馈测试",
          content: "",
          evidence: {},
          proposedActions: [],
        },
      });
      const feedbackResults = await Promise.all(Array.from({ length: 8 }, () =>
        recordFeedback(projectA, concurrent.id, { feedbackType: "IGNORED" }),
      ));
      expect(feedbackResults.filter((result) => result.created)).toHaveLength(1);
      expect(await db.interventionFeedback.count({ where: { interventionId: concurrent.id } })).toBe(1);
    });

    it("keeps system notification publication separate and idempotent from exposure and feedback", async () => {
      const intervention = await db.agentIntervention.create({
        data: {
          projectId: projectA,
          triggerType: "RISK_UNHANDLED",
          dedupeKey: "delivery-receipt",
          title: "通知回执测试",
          content: "仅记录系统通道结果",
          evidence: {},
          proposedActions: [],
        },
      });
      const first = await recordInterventionDelivery(projectA, intervention.id, {
        deliveryKey: "notification-1",
        status: "PUBLISHED",
        message: "系统 API 已接受发布",
      });
      const replay = await recordInterventionDelivery(projectA, intervention.id, {
        deliveryKey: "notification-1",
        status: "PUBLISHED",
        message: "系统 API 已接受发布",
      });
      expect(replay.id).toBe(first.id);
      expect(await db.interventionDelivery.count({ where: { interventionId: intervention.id } })).toBe(1);
      expect(await db.interventionFeedback.count({ where: { interventionId: intervention.id } })).toBe(0);
      expect((await listInterventionDeliveries(projectA, intervention.id))[0].status).toBe("PUBLISHED");

      const concurrent = await Promise.all(Array.from({ length: 8 }, () => recordInterventionDelivery(projectA, intervention.id, {
        deliveryKey: "notification-concurrent",
        status: "PUBLISHED",
      })));
      expect(new Set(concurrent.map((item) => item.id)).size).toBe(1);
      const failedRetry = await recordInterventionDelivery(projectA, intervention.id, {
        deliveryKey: "notification-1",
        status: "FAILED",
        message: "后续重试失败",
      });
      expect(failedRetry.status).toBe("PUBLISHED");
    });
  });

  it("accepts one intervention concurrently without creating duplicate actions", async () => {
    const project = await db.project.create({
      data: { title: "阶段二行动幂等", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const intervention = await db.agentIntervention.create({
        data: {
          projectId: project.id,
          triggerType: "RISK_UNHANDLED",
          dedupeKey: "accept-concurrent",
          title: "并发接受提醒",
          content: "",
          evidence: {},
          proposedActions: [{ kind: "create_action", title: "锁定最小交付版本", description: "并发测试" }],
        },
      });
      const results = await Promise.all([
        acceptIntervention(project.id, intervention.id),
        acceptIntervention(project.id, intervention.id),
      ]);
      expect(new Set(results.map((result) => result.action.id)).size).toBe(1);
      expect(await db.actionItem.count({ where: { projectId: project.id, sourceInterventionId: intervention.id } })).toBe(1);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });
});
