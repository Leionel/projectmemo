import { AppError } from "@/lib/api";
import { ZodError } from "zod";
import type { Decision } from "./contracts";
import { createHash } from "node:crypto";

export type MissionPhase = "CONTEXT" | "DECISION" | "TOOL" | "VERIFY" | "COMMIT" | "APPROVAL";
export type MissionRecovery = {
  kind: "MODEL_FORMAT_RETRY" | "RESEARCH_RETRY" | "REVIEW_REQUIRED" | "BUDGET_REVIEW" | "STOP_REQUESTED";
  automatic: boolean;
  message: string;
  attempt?: number;
  maxAttempts?: number;
  nextAttemptAt?: string;
};
export type MissionContextManifest = {
  schemaVersion: 1;
  hash: string;
  contextSchemaVersion: number | null;
  goalHash: string;
  contextVersion: number;
  planRevision: number;
  constraintsVersion: number;
  scopeRevision: number;
  inputEventSeqs: number[];
  includedStepIds: string[];
  excludedStepIds: string[];
  sourcePointers: Array<{ id: string; hash: string; revision: string }>;
  promptVersion?: string;
  notLoadedStepCount?: number;
};

const hashText = (text: string) => createHash("sha256").update(text).digest("hex");
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9:_-]{1,180}$/.test(value);
const safeHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** A bounded view of the actual context, without goal text, inputs or source excerpts. */
export function missionContextManifest(context: string, versions: {
  contextVersion: number; planRevision: number; constraintsVersion: number; researchScopeVersion: number;
}): MissionContextManifest {
  const parsed = JSON.parse(context) as {
    schemaVersion?: number; promptVersion?: string; goal?: string; recentInputs?: Array<{ seq?: number }>;
    sourceIndex?: Array<{ id?: string; hash?: string; revision?: string }>;
    manifest?: { excludedStepIds?: unknown[]; notLoadedStepCount?: number };
    observations?: Array<{ stepId?: string; observation?: { sources?: Array<{ id?: string; hash?: string; revision?: string }> } }>;
  };
  const observations = parsed.observations ?? [];
  const pointers = [...observations.flatMap(item => item.observation?.sources ?? []), ...(parsed.sourceIndex ?? [])]
    .filter((source): source is { id: string; hash: string; revision: string } => safeId(source.id) && safeHash(source.hash) && safeId(source.revision));
  return {
    schemaVersion: 1,
    promptVersion: parsed.promptVersion === "mission-context-v2" ? parsed.promptVersion : undefined,
    notLoadedStepCount: Number.isInteger(parsed.manifest?.notLoadedStepCount) ? parsed.manifest?.notLoadedStepCount : undefined,
    hash: hashText(context),
    contextSchemaVersion: Number.isInteger(parsed.schemaVersion) ? parsed.schemaVersion! : null,
    goalHash: hashText(typeof parsed.goal === "string" ? parsed.goal : ""),
    contextVersion: versions.contextVersion,
    planRevision: versions.planRevision,
    constraintsVersion: versions.constraintsVersion,
    scopeRevision: versions.researchScopeVersion,
    inputEventSeqs: (parsed.recentInputs ?? []).map(input => input.seq).filter((seq): seq is number => Number.isInteger(seq)).slice(-32),
    includedStepIds: observations.map(item => item.stepId).filter(safeId).slice(-32),
    excludedStepIds: (parsed.manifest?.excludedStepIds ?? []).filter(safeId).slice(0, 128),
    sourcePointers: [...new Map(pointers.map(source => [source.id, { id: source.id, hash: source.hash, revision: source.revision }])).values()].slice(0, 128),
  };
}

const phaseMessages: Record<MissionPhase, string> = {
  CONTEXT: "委托上下文无法重建，请核对材料和配置后继续",
  DECISION: "委托决策暂未完成，请检查模型服务后继续",
  TOOL: "委托工具执行失败，请检查原因后继续",
  VERIFY: "委托核验未完成，请核对验收条件后继续",
  COMMIT: "委托结果未能保存，请刷新核对后继续",
  APPROVAL: "委托批准未能提交，请重新核对提案后继续",
};

/** Only an explicit adapter protocol error (or the legacy decision contract) warrants format repair. */
export function missionFailure(error: unknown, phase: MissionPhase) {
  const protocol = error instanceof ModelProtocolError || phase === "DECISION" && error instanceof AppError && error.code === "MODEL_PROTOCOL_ERROR";
  const trusted = error instanceof AppError && (error.code !== "MODEL_PROTOCOL_ERROR" || protocol);
  const category = protocol ? "MODEL_PROTOCOL" : error instanceof SyntaxError ? "LOCAL_PARSE"
    : error instanceof ZodError ? "LOCAL_VALIDATION"
      : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name) ? "TIMEOUT"
        : trusted ? "DOMAIN" : "EXECUTION";
  return {
    code: trusted ? error.code : "EXECUTION_FAILED",
    message: trusted ? error.message : phaseMessages[phase],
    phase, category, protocol,
    diagnostic: error instanceof ModelProtocolError ? error.diagnostic : undefined,
    metadata: error instanceof ModelProtocolError ? error.metadata : undefined,
  };
}

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
  public metadata: Pick<Decision, "provider" | "model" | "protocol" | "usage">;
  constructor(public diagnostic: ProtocolDiagnostic, metadata: Pick<Decision, "provider" | "model" | "protocol" | "usage">) {
    super("MODEL_PROTOCOL_ERROR", messages[diagnostic.reason], 409, diagnostic);
    // Do not retain extra fields from a Decision object supplied by a caller.
    this.metadata = { provider: metadata.provider, model: metadata.model, protocol: metadata.protocol,
      usage: { inputTokens: metadata.usage.inputTokens, outputTokens: metadata.usage.outputTokens } };
  }
}
export function protocolDiagnostic(reason: ProtocolReason, finishReason: unknown, responseChars: number, issues?: ProtocolDiagnostic["issues"]): ProtocolDiagnostic {
  return { reason, repairHint: hints[reason], finishReason: typeof finishReason === "string" ? (["stop", "length", "tool_calls", "content_filter"].includes(finishReason) ? finishReason as ProtocolDiagnostic["finishReason"] : "other") : null, responseChars, ...(issues ? { issues } : {}) };
}
