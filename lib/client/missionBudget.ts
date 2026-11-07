import { missionBudgetReviewCaps as caps } from "@/lib/types/missionBudget";

type BudgetMission = { status: string; pauseReason?: string | null; error?: unknown };
const errorCode = (mission: BudgetMission) => (mission.error as { code?: string | null } | null | undefined)?.code;

/** 只有服务端明确因额度暂停时才提供“加额度”；其他暂停直接继续，不提高上限。 */
export function isBudgetPause(mission: BudgetMission) {
  if (mission.status !== "PAUSED") return false;
  return mission.pauseReason === "BUDGET" || mission.pauseReason === "BUDGET_EXCEEDED" || errorCode(mission) === "BUDGET_EXHAUSTED";
}

/** 加额度继续后，旧的额度错误要等下一步执行才会被覆盖；这段时间委托在排队或运行，不该再提示“需要恢复”。 */
export function isStaleBudgetError(mission: BudgetMission) {
  return errorCode(mission) === "BUDGET_EXHAUSTED" && (mission.status === "READY" || mission.status === "RUNNING");
}

/** 下一档累计上限。只提高上限：已用和预占保留，新的外部效果仍需逐项批准。 */
export function nextBudgetTotals(budget: Record<string, number>) {
  return {
    metadataRequests: Math.min(caps.metadataRequests, (budget.metadataRequests ?? 24) + 24),
    browserRequests: Math.min(caps.browserRequests, (budget.browserRequests ?? 40) + 40),
    browserBytes: Math.min(caps.browserBytes, (budget.browserBytes ?? 4000000) + 4000000),
    calendarRequests: Math.min(caps.calendarRequests, (budget.calendarRequests ?? 8) + 16),
    externalWrites: Math.min(caps.externalWrites, (budget.externalWrites ?? 2) + 10),
    models: Math.min(caps.models, budget.models + 6),
    tools: Math.min(caps.tools, budget.tools + 8),
    activeMs: Math.min(caps.activeMs, budget.activeMs + 180000),
    reservedOutputTokens: Math.min(caps.reservedOutputTokens, budget.reservedOutputTokens + 12000),
  };
}
