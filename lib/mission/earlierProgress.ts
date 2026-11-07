/**
 * 长委托的早期进展摘要。
 *
 * 上下文只放最近的完整步骤，更早的判断会被挤出去，模型可能重复读取或忘记走过的路。
 * 这里把被挤出的步骤滚动压成线索：确定性生成，不调用模型、不计入额度、不写库，原步骤保留。
 * 只取工具、状态、模型当时写的一句话、来源名和失败原因，不带工具结果正文。
 * 摘要不是证据：要引用必须重新读取原来源。来源受限的步骤只留序号和工具。
 */
export type EarlierStep = {
  ordinal: number; tool: string; status: string; historical: boolean; withheld: boolean;
  note?: string; sources?: string[]; failure?: string;
};
export type EarlierInput = { seq: number; answer: string };
export type EarlierProgress = {
  policy: string;
  steps: Array<Omit<EarlierStep, "withheld" | "historical"> & { historical?: true; withheld?: true }>;
  inputs: EarlierInput[];
  rolledUp: { steps: number; inputs: number; byTool: Record<string, number> };
};

export const EARLIER_PROGRESS_MAX_CHARS = 2400;
const POLICY = "早期步骤的线索，不是证据；不能用于引用或下结论，需要依据时重新读取原来源。不要重复已成功的相同读取。";
const clip = (value: unknown, limit: number) => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
};

export function buildEarlierProgress(rows: EarlierStep[], inputs: EarlierInput[], unlistedSteps = 0, maxChars = EARLIER_PROGRESS_MAX_CHARS): EarlierProgress | undefined {
  if (!rows.length && !inputs.length && !unlistedSteps) return undefined;
  const entries = [...rows].sort((a, b) => a.ordinal - b.ordinal).map(row => {
    const entry: EarlierProgress["steps"][number] = { ordinal: row.ordinal, tool: row.tool, status: row.status };
    if (row.historical) entry.historical = true;
    if (row.withheld) { entry.withheld = true; return { row, entry }; }
    const note = clip(row.note, 80), failure = clip(row.failure, 80), sources = (row.sources ?? []).map(source => clip(source, 40)).filter((source): source is string => !!source).slice(0, 3);
    if (note) entry.note = note;
    if (failure) entry.failure = failure;
    if (sources.length) entry.sources = sources;
    return { row, entry };
  });
  const answers = [...inputs].sort((a, b) => a.seq - b.seq).map(input => ({ seq: input.seq, answer: clip(input.answer, 160) ?? "" })).filter(input => input.answer);
  const value: EarlierProgress = { policy: POLICY, steps: entries.map(item => item.entry), inputs: answers, rolledUp: { steps: unlistedSteps, inputs: 0, byTool: {} } };
  // 超长时先合并最早的步骤。用户的回答比工具记录更重要，步骤合并完才丢回答。
  while (JSON.stringify(value).length > maxChars && value.steps.length) {
    const dropped = value.steps.shift()!;
    value.rolledUp.steps++;
    value.rolledUp.byTool[dropped.tool] = (value.rolledUp.byTool[dropped.tool] ?? 0) + 1;
  }
  while (JSON.stringify(value).length > maxChars && value.inputs.length) { value.inputs.shift(); value.rolledUp.inputs++; }
  return value;
}
