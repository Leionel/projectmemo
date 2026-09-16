import { buildArtifactPrompt, buildCapturePrompt } from "@/lib/agent/prompts";
import { getChatProviderConfig } from "@/lib/config/provider";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { AgentExecutionResult, ArtifactTypeValue, CardDraft } from "@/lib/types";

type ChatResponse = { choices?: Array<{ message?: { content?: string } }> };

function config() {
  return getChatProviderConfig();
}

export async function chatWithLLMWithMeta(prompt: string): Promise<AgentExecutionResult<string>> {
  const startedAt = Date.now();
  const { provider, baseUrl, apiKey, model, timeoutMs } = config();
  const requestBody: Record<string, unknown> = {
    model,
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }],
  };
  // DeepSeek 当前默认启用思考模式。ProjectMemo 需要低延迟、可解析的
  // 结构化 content，因此显式使用非思考模式；其他兼容服务不接收该字段。
  if (provider === "deepseek") {
    requestBody.thinking = { type: "disabled" };
  }
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`LLM request failed with HTTP ${response.status}`);
  const payload = await response.json().catch(() => {
    throw new Error("LLM returned invalid JSON");
  }) as ChatResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return {
    data: content.trim(),
    provider: `llm:${provider}:${model}`,
    status: "SUCCESS",
    fallbackReason: null,
    durationMs: Date.now() - startedAt,
  };
}

export async function chatWithLLM(prompt: string) {
  return (await chatWithLLMWithMeta(prompt)).data;
}

export async function structureWithLLM(input: {
  project: { title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
}) {
  const content = await chatWithLLM(buildCapturePrompt(input));
  return knowledgeCardDraftSchema.parse(JSON.parse(content));
}

export async function generateArtifactWithLLM(input: {
  project: { title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  return chatWithLLM(buildArtifactPrompt(input));
}

export async function generateArtifactWithLLMWithMeta(input: {
  project: { title: string; goal: string };
  artifactType: ArtifactTypeValue;
  cards: CardDraft[];
}) {
  return chatWithLLMWithMeta(buildArtifactPrompt(input));
}

export async function chatJson<T>(prompt: string, parse: (value: unknown) => T) {
  return (await chatJsonWithMeta(prompt, parse)).data;
}

export async function chatJsonWithMeta<T>(prompt: string, parse: (value: unknown) => T) {
  const result = await chatWithLLMWithMeta(prompt);
  return {
    ...result,
    data: parse(JSON.parse(result.data)),
  } satisfies AgentExecutionResult<T>;
}
