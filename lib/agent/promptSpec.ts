import { z } from "zod";

export const promptPurposes = ["ROUTE", "INVESTIGATE", "GOAL", "ANSWER", "UI_PLAN", "CHANGE_REVIEW", "DYNAMIC_PLAN", "MISSION", "CAPTURE", "ARTIFACT", "LEGACY_COPILOT"] as const;
export const modelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]), content: z.string().min(1).max(96000),
  toolCallId: z.string().min(1).max(160).optional(),
}).strict().refine(v => v.role === "tool" ? !!v.toolCallId : !v.toolCallId, "工具消息需要绑定原调用编号");
export type ModelMessage = z.infer<typeof modelMessageSchema>;
export const modelMessagesSchema = z.array(modelMessageSchema).min(2).max(64).refine(v =>
  v[0].role === "system" && v.filter(m => m.role === "system").length === 1 && v.some(m => m.role === "user"),
"模型请求需要独立的系统策略和用户消息");

export interface PromptSpec<TInput, TOutput> {
  id: string;
  version: string;
  purpose: typeof promptPurposes[number];
  system: string;
  outputSchemaVersion: number;
  maxOutputTokens: number;
  outputSchema: z.ZodType<TOutput>;
  // Only server-authored policy belongs in system. Source text is serialized data.
  buildMessages: (input: TInput) => Array<ModelMessage & { role: "user" | "assistant" | "tool" }>;
}

export function buildPromptMessages<TInput, TOutput>(spec: PromptSpec<TInput, TOutput>, input: TInput): ModelMessage[] {
  if (!spec.id.trim() || !spec.version.trim() || !Number.isSafeInteger(spec.outputSchemaVersion) || spec.outputSchemaVersion < 1 ||
    !Number.isSafeInteger(spec.maxOutputTokens) || spec.maxOutputTokens < 1)
    throw new Error("INVALID_PROMPT_SPEC");
  return modelMessagesSchema.parse([{ role: "system", content: spec.system }, ...spec.buildMessages(input)]);
}

/** Serializes source material as a data envelope; this does not replace application authorization. */
export function modelDataMessage(data: unknown): ModelMessage & { role: "user" } {
  const content = modelMessageSchema.parse({ role: "user", content: JSON.stringify({ kind: "UNTRUSTED_DATA", data }) }).content;
  return { role: "user", content };
}

export interface ModelCapabilities { systemMessages: boolean; toolMessages: boolean; jsonMode: boolean; }
export function validateModelCapabilities(messages: ModelMessage[], capabilities: ModelCapabilities, requireJsonMode: boolean) {
  modelMessagesSchema.parse(messages);
  if (!capabilities.systemMessages || messages.some(m => m.role === "tool") && !capabilities.toolMessages || requireJsonMode && !capabilities.jsonMode)
    throw new Error("MODEL_CAPABILITY_UNSUPPORTED");
}

/** Includes every message, role, tool ID, and a per-message framing allowance. Not an exact tokenizer. */
export function modelMessagesInputBound(messages: ModelMessage[]): number {
  const validated = modelMessagesSchema.parse(messages);
  return Buffer.byteLength(JSON.stringify({ messages: validated }), "utf8") + 64 * (validated.length + 1);
}

export interface ModelCallReservation {
  callId: string;
  inputTokens: number;
  outputTokens: number;
  state: "RESERVED" | "SETTLED" | "UNKNOWN";
  usage: { inputTokens: number | null; outputTokens: number | null };
}

export function reservedModelUsage(reservations: ModelCallReservation[]) {
  const ids = new Set<string>();
  return reservations.reduce((sum, r) => {
    if (!r.callId || ids.has(r.callId)) throw new Error("DUPLICATE_MODEL_RESERVATION");
    ids.add(r.callId);
    if (!["RESERVED", "SETTLED", "UNKNOWN"].includes(r.state) || ![r.inputTokens, r.outputTokens].every(n => Number.isSafeInteger(n) && n > 0) ||
      ![r.usage.inputTokens, r.usage.outputTokens].every(n => n === null || Number.isSafeInteger(n) && n >= 0) ||
      r.state !== "SETTLED" && (r.usage.inputTokens !== null || r.usage.outputTokens !== null))
      throw new Error("INVALID_MODEL_RESERVATION");
    return { inputTokens: sum.inputTokens + (r.usage.inputTokens ?? r.inputTokens),
      outputTokens: sum.outputTokens + (r.usage.outputTokens ?? r.outputTokens) };
  }, { inputTokens: 0, outputTokens: 0 });
}
