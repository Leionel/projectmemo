import { createMockCard } from "@/lib/agent/mockAgent";
import { structureWithLLM } from "@/lib/agent/llmAgent";
import { getChatProviderDefaults } from "@/lib/config/provider";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { AgentExecutionResult, CardDraft, KnowledgeTypeValue } from "@/lib/types";

export interface StructureCaptureInput {
  project: { title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
  preferredType?: KnowledgeTypeValue;
}

export async function structureCaptureWithMeta(input: StructureCaptureInput): Promise<AgentExecutionResult<CardDraft>> {
  const startTime = Date.now();
  const isLlmMode = process.env.LLM_MODE === "openai-compatible" && Boolean(process.env.LLM_API_KEY);
  const chatDefaults = getChatProviderDefaults();

  if (isLlmMode) {
    try {
      const rawDraft = await structureWithLLM(input);
      const parsedDraft = knowledgeCardDraftSchema.parse(rawDraft);
      const finalDraft = input.preferredType ? { ...parsedDraft, type: input.preferredType } : parsedDraft;
      const durationMs = Date.now() - startTime;
      return {
        data: finalDraft,
        provider: `llm:${chatDefaults.provider}:${chatDefaults.model}`,
        status: "SUCCESS",
        durationMs,
        fallbackReason: null,
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const reason = error instanceof Error ? error.message : "Unknown LLM structure error";
      console.warn("LLM structure failed; falling back to deterministic mock agent:", reason);
      const fallbackDraft = createMockCard(input.rawText, input.preferredType);
      return {
        data: fallbackDraft,
        provider: "mock-fallback",
        status: "FALLBACK",
        fallbackReason: reason,
        durationMs,
      };
    }
  }

  const durationMs = Date.now() - startTime;
  const mockDraft = createMockCard(input.rawText, input.preferredType);
  return {
    data: mockDraft,
    provider: "mock",
    status: "SUCCESS",
    durationMs,
    fallbackReason: null,
  };
}

export async function structureCapture(input: StructureCaptureInput): Promise<CardDraft> {
  const result = await structureCaptureWithMeta(input);
  return result.data;
}
