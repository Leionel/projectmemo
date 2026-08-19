import { createMockCard } from "@/lib/agent/mockAgent";
import { structureWithLLM } from "@/lib/agent/llmAgent";
import { knowledgeCardDraftSchema } from "@/lib/validation/schemas";
import type { KnowledgeTypeValue } from "@/lib/types";

export async function structureCapture(input: {
  project: { title: string; description: string; goal: string };
  rawText: string;
  historyKeywords: string[];
  preferredType?: KnowledgeTypeValue;
}) {
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      const draft = knowledgeCardDraftSchema.parse(await structureWithLLM(input));
      return input.preferredType ? { ...draft, type: input.preferredType } : draft;
    } catch (error) {
      console.warn("LLM structure failed; using deterministic mock agent", error);
    }
  }
  return createMockCard(input.rawText, input.preferredType);
}
