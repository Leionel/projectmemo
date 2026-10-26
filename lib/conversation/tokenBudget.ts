import { AppError } from "@/lib/api";

export type ModelPurpose = "ROUTE" | "ANSWER";
export const turnTokenLimits = { inputTokens: 12000, outputTokens: 4096 };
export const stageOutputLimit = (purpose: ModelPurpose) => purpose === "ROUTE" ? 768 : 2048;
export type TokenReservation = {
  purpose: ModelPurpose; inputTokens: number; outputTokens: number;
  inputAccounting: "UTF8_UPPER_BOUND" | "LEGACY_UNKNOWN";
  state: "RESERVED" | "SETTLED";
  provider?: string;
  usage?: { inputTokens: number | null; outputTokens: number | null };
};

/** A conservative byte bound, not an exact provider tokenizer count. Actual usage replaces it on settlement. */
export function inputTokenBound(prompt: string) { return Buffer.byteLength(prompt, "utf8") + 64; }
export function tokenReservations(value: unknown): TokenReservation[] {
  if (!Array.isArray(value)) return [];
  return value.map(entry => typeof entry === "string"
    ? { purpose: entry as ModelPurpose, inputTokens: turnTokenLimits.inputTokens, outputTokens: 2048,
      inputAccounting: "LEGACY_UNKNOWN" as const, state: "RESERVED" as const }
    : entry as TokenReservation);
}
export function reserveTurnTokens(previous: unknown, purpose: ModelPurpose, inputTokens: number, outputTokens: number) {
  const entries = tokenReservations(previous);
  if (entries.some(e => e.purpose === purpose) || entries.length >= 2)
    throw new AppError("CALL_ALREADY_RESERVED", "本次模型请求已经发出，请读取原回执", 409);
  if (![inputTokens, outputTokens].every(n => Number.isSafeInteger(n) && n > 0) || outputTokens > stageOutputLimit(purpose))
    throw new AppError("INVALID_TOKEN_RESERVATION", "本次模型预算无效", 422);
  const used = entries.reduce((sum, e) => ({ inputTokens: sum.inputTokens + (e.usage?.inputTokens ?? e.inputTokens),
    outputTokens: sum.outputTokens + (e.usage?.outputTokens ?? e.outputTokens) }), { inputTokens: inputTokens, outputTokens: outputTokens });
  if (used.inputTokens > turnTokenLimits.inputTokens || used.outputTokens > turnTokenLimits.outputTokens)
    throw new AppError("CONVERSATION_TOKEN_BUDGET_EXHAUSTED", "本次讨论资料超出分析预算，请缩小项目范围后重试", 409);
  return [...entries, { purpose, inputTokens, outputTokens, inputAccounting: "UTF8_UPPER_BOUND" as const, state: "RESERVED" as const }];
}
