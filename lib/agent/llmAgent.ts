import { reserveCloudCall, reserveWorkspaceCloudCall, reserveReviewCloudCall, settleWorkspaceCloudCall, commitWorkspaceDispatch, type WorkspaceBilling, type ReviewBilling } from "@/lib/auth/cloudQuota";
import { inputTokenBound, stageOutputLimit } from "@/lib/conversation/tokenBudget";
import { AppError } from "@/lib/api";
import { artifactCoverageV2, captureFidelityV2 } from "@/lib/agent/specialistPrompts";
import { getChatProviderConfig } from "@/lib/config/provider";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { AgentExecutionResult, ArtifactTypeValue, CardDraft } from "@/lib/types";
import { buildPromptMessages, modelMessagesInputBound, modelMessagesSchema, validateModelCapabilities, type ModelMessage, type PromptSpec } from "./promptSpec";

type ChatResponse = { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };

function config() {
  return getChatProviderConfig();
}

export async function chatWithLLMWithMeta(prompt: string | ModelMessage[], projectId?: string, workspace?: WorkspaceBilling, review?: ReviewBilling,
  task?: { outputTokens: number; jsonOutput: boolean }): Promise<AgentExecutionResult<string>> {
  const startedAt = Date.now();
  const { provider, baseUrl, apiKey, model, timeoutMs } = config();
  const messages = typeof prompt === "string" ? [{ role: "user", content: prompt }] : modelMessagesSchema.parse(prompt);
  const supportsJson = provider === "deepseek" || process.env.LLM_JSON_MODE === "true";
  if (typeof prompt !== "string") validateModelCapabilities(prompt, { systemMessages: true, toolMessages: false, jsonMode: supportsJson }, false);
  const billing = workspace ? { ...workspace, inputTokens: typeof prompt === "string" ? inputTokenBound(prompt) : modelMessagesInputBound(prompt),
    outputTokens: workspace.outputTokens ?? stageOutputLimit(workspace.purpose), provider: `llm:${provider}:${model}` } : undefined;
  if (review) await reserveReviewCloudCall(review);
  else if (billing) await reserveWorkspaceCloudCall(billing);
  else await reserveCloudCall(projectId);
  const requestBody: Record<string, unknown> = {
    max_tokens: billing?.outputTokens ?? task?.outputTokens ?? 2048,
    model,
    temperature: 0.2,
    messages,
  };
  // DeepSeek 当前默认启用思考模式。ProjectMemo 需要低延迟、可解析的
  // 结构化 content，因此显式使用非思考模式；其他兼容服务不接收该字段。
  if (provider === "deepseek") {
    requestBody.thinking = { type: "disabled" };
  }
  if (supportsJson && (workspace || review || task?.jsonOutput)) requestBody.response_format = { type: "json_object" };
  if (billing) await commitWorkspaceDispatch(billing);
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(workspace ? Math.min(timeoutMs, 20000) : timeoutMs),
  });
  async function rejectReceived(code: string, message: string): Promise<never> {
    if (billing) await settleWorkspaceCloudCall(billing, { data: "", provider: `llm:${provider}:${model}`, status: "FAILED",
      durationMs: Date.now() - startedAt, usage: { inputTokens: null, outputTokens: null }, usageUnknown: true });
    throw new AppError(code, message, 503, { httpStatus: response.status, provider: `llm:${provider}:${model}` });
  }
  if (!response.ok) return rejectReceived("MODEL_HTTP_REJECTED", response.status === 401 || response.status === 403
    ? "模型鉴权失败，请检查服务端模型配置" : response.status === 429 ? "云模型额度或频率受限，请稍后重试" : `云模型请求失败（HTTP ${response.status}）`);
  const payload = await response.json().catch(() => rejectReceived("MODEL_RESPONSE_INVALID", "云模型返回格式异常，原请求不会自动重发")) as ChatResponse;
  if (!payload || typeof payload !== "object") return rejectReceived("MODEL_RESPONSE_INVALID", "云模型返回格式异常，原请求不会自动重发");
  const tokenValue = (n: number | undefined) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
  const usage = { inputTokens: tokenValue(payload.usage?.prompt_tokens), outputTokens: tokenValue(payload.usage?.completion_tokens) };
  const content = payload.choices?.[0]?.message?.content, finishReason = payload.choices?.[0]?.finish_reason ?? null;
  const failure = finishReason === "length" ? "MODEL_OUTPUT_TRUNCATED" : finishReason === "content_filter" ? "MODEL_OUTPUT_FILTERED" : !content?.trim() ? "MODEL_EMPTY_RESPONSE" : null;
  const result: AgentExecutionResult<string> = {
    data: content?.trim() ?? "",
    provider: `llm:${provider}:${model}`,
    status: failure && (workspace || review) ? "FAILED" : "SUCCESS",
    fallbackReason: failure,
    finishReason,
    durationMs: Date.now() - startedAt,
    requestIdentity: payload.id ?? null,
    usage,
    usageUnknown: usage.inputTokens === null || usage.outputTokens === null,
  };
  if (billing) await settleWorkspaceCloudCall(billing, result);
  if (!content && !workspace && !review) throw new Error("LLM returned empty content");
  return result;
}

export async function chatWithLLM(prompt: string, projectId?: string) {
  return (await chatWithLLMWithMeta(prompt, projectId)).data;
}

/** One versioned task, one original provider/quota call. Parsing stays with the existing consumer. */
export async function chatPromptWithMeta<TInput, TOutput>(spec: PromptSpec<TInput, TOutput>, input: TInput, projectId?: string, review?: ReviewBilling) {
  const result = await chatWithLLMWithMeta(buildPromptMessages(spec, input), projectId, undefined, review,
    { outputTokens: spec.maxOutputTokens, jsonOutput: spec.outputFormat !== "TEXT" });
  return { ...result, prompt: { id: spec.id, version: spec.version, purpose: spec.purpose, outputSchemaVersion: spec.outputSchemaVersion } };
}

export async function structureWithLLM(input: {
  project: { id?: string; title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
}) {
  return (await structureWithLLMWithMeta(input)).data;
}

export async function structureWithLLMWithMeta(input: Parameters<typeof structureWithLLM>[0]) {
  const execution = await chatPromptWithMeta(captureFidelityV2, input, input.project.id);
  try {
    if (execution.status === "FAILED") throw new Error(execution.fallbackReason ?? "MODEL_RESPONSE_INVALID");
    return { ...execution, data: knowledgeCardDraftSchema.parse(JSON.parse(execution.data)) };
  } catch {
    throw new AppError(execution.fallbackReason ?? "MODEL_OUTPUT_INVALID", "记录整理未完成，原文已保留", 503,
      { modelAudit: { prompt: execution.prompt, usage: execution.usage, usageUnknown: execution.usageUnknown, requestIdentity: execution.requestIdentity } });
  }
}

export async function generateArtifactWithLLM(input: {
  project: { id?: string; title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  return (await generateArtifactWithLLMWithMeta(input)).data;
}

export async function generateArtifactWithLLMWithMeta(input: {
  project: { id?: string; title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
  sources?: unknown;
  coverage?: unknown;
}) {
  return chatPromptWithMeta(artifactCoverageV2, input, input.project.id);
}

export async function chatJson<T>(prompt: string, parse: (value: unknown) => T, projectId?: string) {
  return (await chatJsonWithMeta(prompt, parse, projectId)).data;
}

export async function chatJsonWithMeta<T>(prompt: string, parse: (value: unknown) => T, projectId?: string) {
  const result = await chatWithLLMWithMeta(prompt, projectId);
  return {
    ...result,
    data: parse(JSON.parse(result.data)),
  } satisfies AgentExecutionResult<T>;
}
