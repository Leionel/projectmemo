process.env.INTERVENTION_BUDGET_ENABLED = "1";

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "@/lib/db";
import {
  applyInterventionPolicy,
  getOrCreatePolicy,
  restoreDefaultPolicy,
  updatePolicy,
  type PolicyCandidate,
} from "@/lib/services/interventionPolicyService";
import {
  confirmSuggestion,
  dismissSuggestion,
  computeSuggestion,
  recordFeedback,
  revertTopicReduction,
} from "@/lib/services/interventionFeedbackService";

process.env.INTERVENTION_BUDGET_ENABLED = "1";

function candidate(overrides: Partial<PolicyCandidate> = {}): PolicyCandidate {
  return {
    candidateKey: "RISK_UNHANDLED:risk-test",
    triggerType: "RISK_UNHANDLED",
    dedupeKey: "risk-test",
    severity: 4,
    title: "测试提醒",
    content: "测试内容",
    evidenceFacts: ["风险卡片：测试"],
    evidenceCardIds: [],
    evidenceRule: "test_rule",
    proposedActions: [],
    isSimulated: false,
    ...overrides,
  };
}

describe("Intervention budget and quiet hours (B1)", () => {
  let projectIdA: string;
  let projectIdB: string;

  beforeAll(async () => {
    await restoreDefaultPolicy();
    const a = await db.project.create({
      data: { title: "预算测试项目A", description: "", goal: "", scenario: "COMPETITION" },
    });
    const b = await db.project.create({
      data: { title: "预算测试项目B", description: "", goal: "", scenario: "COMPETITION" },
    });
    projectIdA = a.id;
    projectIdB = b.id;
  });

  beforeEach(async () => {
    await db.interventionDecision.deleteMany({});
    await db.interventionBudgetLedger.deleteMany({});
  });

  afterAll(async () => {
    await db.project.delete({ where: { id: projectIdA } }).catch(() => {});
    await db.project.delete({ where: { id: projectIdB } }).catch(() => {});
    await restoreDefaultPolicy().catch(() => {});
  });

  it("suppresses during the cross-midnight quiet window in the configured timezone", async () => {
    await updatePolicy({ quietStartMinute: 1380, quietEndMinute: 480 });
    // 15:30 UTC = 23:30 上海时间 → 静默
    const lateNight = await applyInterventionPolicy(projectIdA, [candidate()], new Date("2026-09-12T15:30:00Z"));
    expect(lateNight[0].decision).toBe("SUPPRESS");
    expect(lateNight[0].reasonCode).toBe("QUIET_HOURS");

    // 23:00 UTC = 次日 07:00 上海时间 → 仍在静默窗口
    const earlyMorning = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-early" })], new Date("2026-09-12T23:00:00Z"));
    expect(earlyMorning[0].reasonCode).toBe("QUIET_HOURS");

    // 04:00 UTC = 12:00 上海时间 → 允许
    const noon = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-noon" })], new Date("2026-09-12T04:00:00Z"));
    expect(noon[0].decision).toBe("FIRE");
  });

  it("suppresses duplicates on refresh and fires again after the reminder is dismissed", async () => {
    await updatePolicy({ dailyBudget: 10, quietStartMinute: 1380, quietEndMinute: 480 });
    const now = new Date("2026-09-13T04:00:00Z");
    const first = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-dup" })], now);
    expect(first[0].decision).toBe("FIRE");
    expect(first[0].interventionId).not.toBeNull();

    const second = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-dup" })], now);
    expect(second[0].decision).toBe("SUPPRESS");
    expect(second[0].reasonCode).toBe("DUPLICATE");

    await db.agentIntervention.update({
      where: { id: first[0].interventionId! },
      data: { status: "DISMISSED", handledAt: new Date() },
    });
    const third = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-dup", severity: 5 })], now);
    expect(third[0].decision).toBe("FIRE");
  });

  it("suppresses snoozed candidates until the snooze expires", async () => {
    const now = new Date("2026-09-14T04:00:00Z");
    const first = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-snooze" })], now);
    expect(first[0].decision).toBe("FIRE");

    await db.agentIntervention.update({
      where: { id: first[0].interventionId! },
      data: { status: "OPEN", snoozedUntil: new Date(now.getTime() + 86400000) },
    });
    const during = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "risk-snooze" })], now);
    expect(during[0].reasonCode).toBe("SNOOZED");

    const afterExpiry = await applyInterventionPolicy(
      projectIdA,
      [candidate({ dedupeKey: "risk-snooze" })],
      new Date(now.getTime() + 2 * 86400000),
    );
    expect(afterExpiry[0].decision).toBe("FIRE");
  });

  it("suppresses candidates without evidence facts", async () => {
    const outcome = await applyInterventionPolicy(
      projectIdA,
      [candidate({ dedupeKey: "risk-noevidence", evidenceFacts: [] })],
      new Date("2026-09-14T04:00:00Z"),
    );
    expect(outcome[0].reasonCode).toBe("INSUFFICIENT_EVIDENCE");
  });

  it("enforces a shared daily budget across projects in the local day", async () => {
    await updatePolicy({ dailyBudget: 2, quietStartMinute: 1380, quietEndMinute: 480 });
    const now = new Date("2026-09-15T04:00:00Z");

    const firstA = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "budget-a1" })], now);
    const firstB = await applyInterventionPolicy(projectIdB, [candidate({ dedupeKey: "budget-b1", candidateKey: "RISK_UNHANDLED:budget-b1" })], now);
    expect(firstA[0].decision).toBe("FIRE");
    expect(firstB[0].decision).toBe("FIRE");

    // 第 3 次（跨项目共享全局预算）应被抑制
    const third = await applyInterventionPolicy(projectIdA, [candidate({ dedupeKey: "budget-a2" })], now);
    expect(third[0].reasonCode).toBe("BUDGET_EXHAUSTED");
    expect(third[0].whyNow).toContain("预算");

    // 跨午夜后预算恢复（次日 10:00 上海时间，非静默窗口）
    const nextDay = await applyInterventionPolicy(
      projectIdA,
      [candidate({ dedupeKey: "budget-a3" })],
      new Date("2026-09-16T02:00:00Z"),
    );
    expect(nextDay[0].decision).toBe("FIRE");
  });

  it("reduced topics fire at most once per day and can be reverted", async () => {
    await updatePolicy({ dailyBudget: 10, quietStartMinute: 1380, quietEndMinute: 480 });
    await revertTopicReduction(projectIdA, "PROJECT_STALE").catch(() => {});
    await confirmSuggestion(projectIdA, "PROJECT_STALE");
    const now = new Date("2026-09-18T04:00:00Z");

    const first = await applyInterventionPolicy(
      projectIdA,
      [candidate({ candidateKey: "PROJECT_STALE:topic-1", triggerType: "PROJECT_STALE", dedupeKey: "topic-1" })],
      now,
    );
    expect(first[0].decision).toBe("FIRE");

    const second = await applyInterventionPolicy(
      projectIdA,
      [candidate({ candidateKey: "PROJECT_STALE:topic-2", triggerType: "PROJECT_STALE", dedupeKey: "topic-2" })],
      now,
    );
    expect(second[0].decision).toBe("SUPPRESS");
    expect(second[0].reasonCode).toBe("TOPIC_REDUCED");

    await revertTopicReduction(projectIdA, "PROJECT_STALE");
    const third = await applyInterventionPolicy(
      projectIdA,
      [candidate({ candidateKey: "PROJECT_STALE:topic-3", triggerType: "PROJECT_STALE", dedupeKey: "topic-3" })],
      now,
    );
    expect(third[0].decision).toBe("FIRE");
  });

  it("records app exposures idempotently and ignores foreign project ids", async () => {
    const { recordFeedback } = await import("@/lib/services/interventionFeedbackService");
    const intervention = await db.agentIntervention.create({
      data: {
        projectId: projectIdA,
        triggerType: "PROJECT_STALE",
        dedupeKey: "exposure-dup-1",
        title: "曝光测试",
        content: "",
        evidence: {},
        proposedActions: [],
      },
    });

    const first = await recordFeedback(projectIdA, intervention.id, { feedbackType: "EXPOSED" });
    expect(first.created).toBe(true);
    const repeat = await recordFeedback(projectIdA, intervention.id, { feedbackType: "EXPOSED" });
    expect(repeat.created).toBe(false);

    // 跨项目 id 直接忽略（批量上报不打断）
    const other = await db.project.create({
      data: { title: "曝光外部项目", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      await expect(
        recordFeedback(other.id, intervention.id, { feedbackType: "EXPOSED" }),
      ).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: other.id } }).catch(() => {});
    }

    // 曝光不计入偏好建议统计（仅 IGNORED/ACCEPTED 参与）
    const suggestions = await computeSuggestion(projectIdA);
    expect(suggestions.find((item) => item.triggerType === "PROJECT_STALE")).toBeUndefined();
  });

  it("records feedback idempotently and suggests frequency reduction after repeated ignores", async () => {
    const card = await db.knowledgeCard.create({
      data: {
        projectId: projectIdA,
        captureId: (await db.capture.create({
          data: { projectId: projectIdA, rawText: "反馈测试卡", sourceType: "测试" },
        })).id,
        type: "risk",
        title: "反馈测试风险卡",
        summary: "",
        keywords: [],
        relatedTasks: [],
        nextActions: [],
        importance: 4,
      },
    });

    for (let i = 0; i < 3; i++) {
      const intervention = await db.agentIntervention.create({
        data: {
          projectId: projectIdA,
          triggerType: "DELIVERABLE_GAP",
          dedupeKey: `feedback-dup-${i}`,
          title: `反馈测试 ${i}`,
          content: "",
          evidence: {},
          proposedActions: [],
          evidenceCardId: card.id,
        },
      });
      const first = await recordFeedback(projectIdA, intervention.id, { feedbackType: "IGNORED" });
      expect(first.created).toBe(true);
      const repeat = await recordFeedback(projectIdA, intervention.id, { feedbackType: "IGNORED" });
      expect(repeat.created).toBe(false);
    }

    const suggestions = await computeSuggestion(projectIdA);
    const gapSuggestion = suggestions.find((item) => item.triggerType === "DELIVERABLE_GAP");
    expect(gapSuggestion).toBeDefined();
    expect(gapSuggestion?.text).toContain("降低");

    await confirmSuggestion(projectIdA, "DELIVERABLE_GAP");
    expect((await computeSuggestion(projectIdA)).find((item) => item.triggerType === "DELIVERABLE_GAP")).toBeUndefined();

    const policy = await getOrCreatePolicy();
    const reduced = policy.reducedTopics as Array<{ triggerType: string }>;
    expect(reduced.some((item) => item.triggerType === "DELIVERABLE_GAP")).toBe(true);
    await revertTopicReduction(projectIdA, "DELIVERABLE_GAP");

    // dismiss 后不再重复提出
    await dismissSuggestion(projectIdA, "DELIVERABLE_GAP");
    expect((await computeSuggestion(projectIdA)).find((item) => item.triggerType === "DELIVERABLE_GAP")).toBeUndefined();
  });
});
