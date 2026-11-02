/** 原累计计数的只读视图，不从事件条数重算，不推断费用或现实收益。 */
export function missionResourceUsageOf(value: unknown) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const count = (key: string): number | null => {
    const n = raw[key];
    return typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  };
  const models = count("models"), tools = count("tools"), unknownCalls = count("unknownCalls");
  return {
    schemaVersion: 1 as const,
    scope: "MISSION_RECORDED_COUNTERS_ONLY" as const,
    models, tools, inputTokens: count("inputTokens"), outputTokens: count("outputTokens"), unknownCalls,
    monetaryCost: null,
    pricingState: "UNPRICED" as const,
    summary: `模型 ${models ?? "待核对"} 次 · 工具 ${tools ?? "待核对"} 次`,
    coverageNote: unknownCalls === null ? "未知请求数量尚未记录，当前用量覆盖不明。"
      : unknownCalls > 0 ? `有 ${unknownCalls} 次请求结果或用量未知，已记录 token 不代表完整用量。`
      : "仅含当前委托已记录的累计计数；不含建项预览或其他独立讨论。",
    costNote: "费用尚不能核算：这些记录未绑定费率与账单。",
  };
}
