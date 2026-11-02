/**
 * 本次委托“可核对的调用”投影。
 *
 * 只读原 AgentRun 与原 AgentMissionStep：不新建结果账本，也不按事件条数重算预算。
 * 目的不是给出账单，而是说清哪些调用有原回执、哪些结果或用量未知、为什么仍不能估价：
 * 费率需要来源、适用时间、模型/工具版本、币种与计价条件，当前都没有绑定。
 */

export type CallCoverageRun = {
  id: string; status: string; provider: string | null; fallbackReason: string | null;
  runType: string; trace: unknown; createdAt: string;
};
export type CallCoverageStep = {
  id: string; status: string; toolName: string; toolVersion: string | null; agentRunId: string | null;
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** 一次调用是否记录了可用量：两个 token 字段都是安全非负整数才算。 */
export function usageRecordedOf(value: unknown): boolean {
  const usage = record(value);
  return numberOrNull(usage.inputTokens) !== null && numberOrNull(usage.outputTokens) !== null;
}

export function missionCallCoverageOf(input: {
  missionId: string;
  agentRuns: CallCoverageRun[];
  steps: CallCoverageStep[];
  limit: number;
  truncated?: boolean;
}) {
  // 原 AgentRun 没有 mission 列；沿用 materialUseProjection 的做法，从 trace.missionId 归属。
  const runs = [...new Map(input.agentRuns.filter(run => record(run.trace).missionId === input.missionId).map(run => [run.id, run])).values()].slice(0, input.limit);
  // 模型调用与工具调用是不同身份：各自按原 ID 计数，不把 step 数量加进模型次数。
  const steps = [...new Map(input.steps.map(step => [step.id, step])).values()].slice(0, input.limit);
  const truncated = input.truncated ?? (input.agentRuns.length >= input.limit || input.steps.length >= input.limit);
  const modelSuccess = runs.filter(run => run.status === "SUCCESS").length;
  const modelFailed = runs.filter(run => run.status === "FAILED").length;
  const modelPartial = runs.filter(run => run.status === "PARTIAL").length;
  const modelFallback = runs.filter(run => run.status === "FALLBACK").length;
  const modelUnknown = runs.length - modelSuccess - modelFailed - modelPartial - modelFallback;
  const usageRecorded = runs.filter(run => usageRecordedOf(record(run.trace).usage)).length;
  const usageUnknown = runs.length - usageRecorded;
  const toolSuccess = steps.filter(step => step.status === "SUCCEEDED").length;
  const toolFailed = steps.filter(step => step.status === "FAILED").length;
  const toolUnknown = steps.filter(step => step.status === "UNKNOWN").length;
  const toolPending = steps.filter(step => ["READY", "RUNNING", "WAITING_APPROVAL"].includes(step.status)).length;
  const failedCodes = [...new Set(runs.flatMap(run => run.fallbackReason ? [run.fallbackReason] : []))].slice(0, 6);
  return {
    schemaVersion: 1 as const,
    scope: "MISSION_AGENTRUN_AND_STEP_RECEIPTS" as const,
    /** 本委托的已检查窗口；服务层多取一条判定是否确有剩余。 */
    inspected: { agentRuns: runs.length, steps: steps.length, limit: input.limit, truncated },
    models: { total: runs.length, succeeded: modelSuccess, failed: modelFailed, partial: modelPartial, fallback: modelFallback, unknown: modelUnknown, usageRecorded, usageUnknown },
    tools: { total: steps.length, succeeded: toolSuccess, failed: toolFailed, unknown: toolUnknown, pending: toolPending },
    failedCodes,
    dedupe: "AGENTRUN_ID_AND_STEP_ID" as const,
    pricing: { state: "UNPRICED" as const, estimate: null, billedAmount: null, currency: null,
      rateSource: null, applicableFrom: null,
      reason: "没有绑定费率来源、适用时间、模型/工具版本与币种；只能给出已记录的调用与 token，不能估价或声称完整账单。" },
    summary: `可核对调用：模型${runs.length === 0 ? "尚未找到回执" : `已检查 ${runs.length} 次（成功 ${modelSuccess} / 失败 ${modelFailed}${modelPartial ? ` / 部分 ${modelPartial}` : ""}${modelFallback ? ` / 降级 ${modelFallback}` : ""}${modelUnknown ? ` / 未知 ${modelUnknown}` : ""}）`}· 工具已检查 ${steps.length} 次（成功 ${toolSuccess} / 失败 ${toolFailed}${toolUnknown ? ` / 未知 ${toolUnknown}` : ""}）`,
    notes: [
      runs.length === 0 ? "尚未找到本委托的模型调用回执，不能据此判断没有调用。"
        : usageUnknown > 0 ? `${usageUnknown} 次模型调用没有完整用量记录，已记录 token 不代表完整用量。`
          : `已检查的 ${runs.length} 条模型回执均记录了输入和输出 token；这不代表完整任务用量。`,
      "费用与估算保持未知：未绑定费率、币种与账单，不把次数换算成金额。",
      "范围仅当前委托的原回执；不含建项预览、其他独立讨论或跨项目用量。",
    ],
  };
}

