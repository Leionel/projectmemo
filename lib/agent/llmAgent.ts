import { reserveCloudCall, reserveWorkspaceCloudCall, reserveReviewCloudCall, settleWorkspaceCloudCall, type WorkspaceBilling, type ReviewBilling } from "@/lib/auth/cloudQuota";
import { inputTokenBound, stageOutputLimit } from "@/lib/conversation/tokenBudget";
import { AppError } from "@/lib/api";
import { buildArtifactPrompt, buildCapturePrompt } from "@/lib/agent/prompts";
import { getChatProviderConfig } from "@/lib/config/provider";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { AgentExecutionResult, ArtifactTypeValue, CardDraft } from "@/lib/types";

type ChatResponse = { id?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: Array<{ finish_reason?: string; message?: { content?: string } }> };

function config() {
  return getChatProviderConfig();
}

export async function chatWithLLMWithMeta(prompt: string, projectId?: string, workspace?: WorkspaceBilling, review?: ReviewBilling): Promise<AgentExecutionResult<string>> {
  const startedAt = Date.now();
  const { provider, baseUrl, apiKey, model, timeoutMs } = config();
  const billing = workspace ? { ...workspace, inputTokens: inputTokenBound(prompt), outputTokens: stageOutputLimit(workspace.purpose), provider: `llm:${provider}:${model}` } : undefined;
  if (review) await reserveReviewCloudCall(review);
  else if (billing) await reserveWorkspaceCloudCall(billing);
  else await reserveCloudCall(projectId);
  const requestBody: Record<string, unknown> = {
    max_tokens: billing?.outputTokens ?? 2048,
    model,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  };
  // DeepSeek 当前默认启用思考模式。ProjectMemo 需要低延迟、可解析的
  // 结构化 content，因此显式使用非思考模式；其他兼容服务不接收该字段。
  if (provider === "deepseek") {
    requestBody.thinking = { type: "disabled" };
    if (workspace || review) requestBody.response_format = { type: "json_object" };
  }
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

export async function structureWithLLM(input: {
  project: { id?: string; title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
}) {
  const content = await chatWithLLM(buildCapturePrompt(input), input.project.id);
  return knowledgeCardDraftSchema.parse(JSON.parse(content));
}

export async function generateArtifactWithLLM(input: {
  project: { id?: string; title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  return chatWithLLM(buildArtifactPrompt(input), input.project.id);
}

export async function generateArtifactWithLLMWithMeta(input: {
  project: { id?: string; title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  return chatWithLLMWithMeta(buildArtifactPrompt(input), input.project.id);
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
