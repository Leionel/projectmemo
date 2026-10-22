import { AppError } from "@/lib/api";
import type { Decision } from "./contracts";

export type ProtocolReason = "INVALID_RESPONSE" | "EMPTY_CONTENT" | "INVALID_JSON" | "TRUNCATED" | "INVALID_CHOICE" | "INVALID_TOOL_ARGUMENTS" | "MULTIPLE_TOOL_CALLS" | "UNKNOWN_TOOL";
export function decisionTokenLimit(lastError: unknown): 1000 | 2000 {
  const error = lastError as {code?:string;diagnostic?:{reason?:string}} | null;
  return error?.code === "MODEL_PROTOCOL_ERROR" && error.diagnostic?.reason === "TRUNCATED" ? 2000 : 1000;
}
const hints: Record<ProtocolReason, string> = {
  INVALID_RESPONSE: "返回一个包含单次决策的 JSON 对象。",
  EMPTY_CONTENT: "回复不能为空；返回一个完整 JSON 决策。",
  INVALID_JSON: "只返回一个完整 JSON 对象，不附解释或 Markdown。",
  TRUNCATED: "上次回复超出长度限制。压缩草稿和摘要，减少内容块，返回完整 JSON；不要续写残缺回复。",
  INVALID_CHOICE: "严格按 responseSchema 返回一个决策，不增加字段。",
  INVALID_TOOL_ARGUMENTS: "按所选工具的 parameters 修正参数名称、类型和长度。",
  MULTIPLE_TOOL_CALLS: "每次只能调用一个工具，收到结果后再决定下一步。",
  UNKNOWN_TOOL: "只能选择 tools 中列出的工具名称。",
};
const messages: Record<ProtocolReason, string> = {
  INVALID_RESPONSE: "模型服务返回了无法识别的响应",
  EMPTY_CONTENT: "模型返回空回复，未执行新步骤",
  INVALID_JSON: "模型回复不是完整的 JSON，未执行新步骤",
  TRUNCATED: "模型回复达到长度上限，未执行截断内容",
  INVALID_CHOICE: "模型决策字段不符合要求，未执行新步骤",
  INVALID_TOOL_ARGUMENTS: "模型提供的工具参数不符合要求，未执行新步骤",
  MULTIPLE_TOOL_CALLS: "模型返回多个并行动作，请重试单步决策",
  UNKNOWN_TOOL: "模型选择了未开放的工具，未执行新步骤",
};
export type ProtocolDiagnostic = {
  reason: ProtocolReason;
  repairHint: string;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "other" | null;
  responseChars: number;
  issues?: Array<{ code: string; path: string }>;
};
/** No raw responses, parser messages, keys or project content enter diagnostics. */
export class ModelProtocolError extends AppError {
  constructor(public diagnostic: ProtocolDiagnostic, public metadata: Pick<Decision, "provider" | "model" | "protocol" | "usage">) {
    super("MODEL_PROTOCOL_ERROR", messages[diagnostic.reason], 409, diagnostic);
  }
}
export function protocolDiagnostic(reason: ProtocolReason, finishReason: unknown, responseChars: number, issues?: ProtocolDiagnostic["issues"]): ProtocolDiagnostic {
  return { reason, repairHint: hints[reason], finishReason: typeof finishReason === "string" ? (["stop", "length", "tool_calls", "content_filter"].includes(finishReason) ? finishReason as ProtocolDiagnostic["finishReason"] : "other") : null, responseChars, ...(issues ? { issues } : {}) };
}
