/**
 * 进展分类的纯投影。
 *
 * 输入只有原 Mission 已有的 Step、Output 逐句核对、Action 与 resultCardId 回执。
 * 它不产生新的完成真值：已执行 ≠ 已观察 ≠ 已独立支持 ≠ 现实目标达成，
 * 用户报告保持“用户报告”，反例保持“反例”，未知不当作失败或没有。
 */

export type ReviewProgressInput = {
  steps: Array<{ status?: string; resultJson: unknown }>;
  outputs: Array<{ id: string; revision: number; claimChecksJson: unknown }>;
  actions: Array<{ id: string; status: string; resultCardId: string | null; isSimulated: boolean }>;
  unknownSteps?: number;
};

export type ReviewProgressClass = {
  key: "executed" | "observed" | "independentlySupported" | "userReported" | "counterExamples" | "unknown";
  label: string;
  count: number;
  note: string;
};

const sourcesOf = (resultJson: unknown) => {
  const value = resultJson && typeof resultJson === "object" ? resultJson as { sources?: unknown } : {};
  return Array.isArray(value.sources) ? value.sources : [];
};

export function reviewProgressOf(input: ReviewProgressInput) {
  const claimChecks = input.outputs.flatMap(output => Array.isArray(output.claimChecksJson)
    ? (output.claimChecksJson as Array<{ status?: string }>) : []);
  const realActions = input.actions.filter(action => !action.isSimulated);
  const counts = {
    executed: { steps: input.steps.length, actions: realActions.filter(a => a.status === "DONE").length },
    observed: { steps: input.steps.filter(step => sourcesOf(step.resultJson).length > 0).length },
    independentlySupported: { claims: claimChecks.filter(c => c.status === "ENTAILS").length },
    userReported: { actionReceipts: realActions.filter(a => !!a.resultCardId).length },
    counterExamples: { claims: claimChecks.filter(c => c.status === "CONTRADICTS").length },
    unknown: { claims: claimChecks.filter(c => c.status === "NOT_ENOUGH_INFORMATION" || c.status === "NOT_CHECKED").length,
      steps: input.unknownSteps ?? input.steps.filter(step => step.status === "UNKNOWN").length },
  };
  const classes: ReviewProgressClass[] = [
    { key: "executed", label: "已执行", count: counts.executed.steps, note: "工具步骤确实运行过；不等于结论成立或目标达成" },
    { key: "observed", label: "已观察", count: counts.observed.steps, note: "执行时带回了可引用来源" },
    { key: "independentlySupported", label: "已独立支持", count: counts.independentlySupported.claims, note: "草稿主张通过逐句核对" },
    { key: "userReported", label: "用户报告", count: counts.userReported.actionReceipts, note: "行动已完成并留下复盘回执；仍是用户报告" },
    { key: "counterExamples", label: "反例", count: counts.counterExamples.claims, note: "原文与主张冲突，保留冲突" },
    { key: "unknown", label: "未知", count: counts.unknown.claims + counts.unknown.steps, note: "未核验或信息不足，不当作失败或没有" },
  ];
  return { schemaVersion: 1 as const, classes, counts,
    policy: "PROJECTION_FROM_EXISTING_STEPS_OUTPUTS_ACTIONS_RECEIPTS_NOT_REALITY_COMPLETION" as const,
    coverage: { outputsInspected: input.outputs.length, stepsInspected: input.steps.length, actionsInspected: realActions.length } };
}

