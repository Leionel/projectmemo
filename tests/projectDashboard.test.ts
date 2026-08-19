import { describe, expect, it } from "vitest";
import { buildCompetitionReadiness, buildProjectDashboard, getDeadlineState, isInterventionActive, sortActions } from "@/lib/projectDashboard";

const now = new Date("2026-07-14T12:00:00.000Z");

describe("project dashboard derivation", () => {
  it("only exposes open reminders and snoozed reminders whose time has arrived", () => {
    expect(isInterventionActive({ status: "OPEN", snoozedUntil: null }, now)).toBe(true);
    expect(isInterventionActive({ status: "ACCEPTED", snoozedUntil: null }, now)).toBe(false);
    expect(isInterventionActive({ status: "SNOOZED", snoozedUntil: "2026-07-14T11:59:59.000Z" }, now)).toBe(true);
    expect(isInterventionActive({ status: "SNOOZED", snoozedUntil: "2026-07-14T12:00:01.000Z" }, now)).toBe(false);
  });

  it("marks deadlines as overdue immediately after the deadline passes", () => {
    expect(getDeadlineState("2026-07-14T11:59:59.000Z", now)).toMatchObject({ kind: "overdue", daysRemaining: -1, rank: 4 });
    expect(getDeadlineState("2026-07-16T12:00:00.000Z", now)).toMatchObject({ kind: "urgent", daysRemaining: 2, rank: 3 });
  });

  it("sorts active actions by overdue, due date, priority and recency", () => {
    const actions = [
      { id: "no-date", status: "TODO", priority: 5, dueAt: null, createdAt: "2026-07-14T10:00:00.000Z" },
      { id: "future", status: "TODO", priority: 4, dueAt: "2026-07-15T12:00:00.000Z", createdAt: "2026-07-14T09:00:00.000Z" },
      { id: "overdue-low", status: "DOING", priority: 1, dueAt: "2026-07-13T12:00:00.000Z", createdAt: "2026-07-14T08:00:00.000Z" },
      { id: "overdue-high", status: "TODO", priority: 5, dueAt: "2026-07-13T12:00:00.000Z", createdAt: "2026-07-14T07:00:00.000Z" },
    ];
    expect(sortActions(actions, "smart", now).map((item) => item.id)).toEqual(["overdue-high", "overdue-low", "future", "no-date"]);
  });

  it("derives all six competition readiness checks without persisted flags", () => {
    const readiness = buildCompetitionReadiness({
      projectId: "demo",
      cards: [{ type: "requirement" }, { type: "experiment_log" }],
      artifacts: [{ artifactType: "competition_outline" }, { artifactType: "defense_ppt" }, { artifactType: "readme" }],
      actions: [{ status: "DONE", resultCardId: "reflection", isSimulated: false }],
      interventions: [{ status: "OPEN", severity: 5, triggerType: "RISK_UNHANDLED", isSimulated: false }],
    }, now);
    expect(readiness).toMatchObject({ completed: 6, total: 6, percentage: 100, blockingRiskCount: 1 });
    expect(readiness.items.every((item) => item.complete)).toBe(true);
  });

  it("selects urgent deadlines before reminders, actions and material gaps", () => {
    const dashboard = buildProjectDashboard({
      projectId: "demo",
      deadline: "2026-07-15T12:00:00.000Z",
      cards: [{ type: "requirement" }],
      artifacts: [],
      actions: [{ status: "TODO", priority: 5, isSimulated: false }],
      interventions: [{ status: "OPEN", severity: 5, triggerType: "RISK_UNHANDLED", isSimulated: false }],
    }, now);
    expect(dashboard.nextAction).toMatchObject({ label: "先处理截止风险", href: "/projects/demo#interventions", tone: "critical" });
    expect(dashboard.activeReminderCount).toBe(1);
    expect(dashboard.activeActionCount).toBe(1);
  });
});
