import { buildArtifactPrompt, buildCapturePrompt } from "@/lib/agent/prompts";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { AgentExecutionResult, ArtifactTypeValue, CardDraft } from "@/lib/types";

type ChatResponse = { choices?: Array<{ message?: { content?: string } }> };

function config() {
  const baseUrl = process.env.LLM_BASE_URL?.replace(/\/$/, "");
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL_NAME;
  if (!baseUrl || !apiKey || !model) throw new Error("LLM configuration is incomplete");
  return { baseUrl, apiKey, model, timeout: Number(process.env.LLM_TIMEOUT_MS ?? 15000) };
}

export async function chatWithLLMWithMeta(prompt: string): Promise<AgentExecutionResult<string>> {
  const startedAt = Date.now();
  const { baseUrl, apiKey, model, timeout } = config();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`LLM request failed with ${response.status}`);
  const payload = (await response.json()) as ChatResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned empty content");
  return {
    data: content.trim(),
    provider: `llm:${model}`,
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
