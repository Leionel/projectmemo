import { requireProject } from "@/lib/repositories/projects";
import { loadRecentCards, saveCaptureResult } from "@/lib/repositories/cards";
import { structureCaptureWithMeta } from "@/lib/agent";
import { KeywordVectorStore } from "@/lib/memory/vectorStore";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { saveAgentRun } from "@/lib/repositories/agent";

const vectorStore = new KeywordVectorStore();

export async function processCapture(projectId: string, rawText: string, sourceType?: string | null) {
  const project = await requireProject(projectId);
  const existingCards = await loadRecentCards(projectId);
  const historyKeywords = [...new Set(existingCards.flatMap((card) => card.keywords))].slice(0, 30);

  const execResult = await structureCaptureWithMeta({ project, rawText, historyKeywords });
  const draft = execResult.data;

  const links = await vectorStore.search(draft, existingCards, 3);
  const saved = await saveCaptureResult({ projectId, rawText, sourceType, draft, links });
  await vectorStore.index({ id: saved.id, title: saved.title, keywords: saved.keywords as string[] });

  await saveAgentRun({
    projectId,
    runType: AgentRunType.CAPTURE,
    status: execResult.status === "SUCCESS"
      ? AgentRunStatus.SUCCESS
      : execResult.status === "FALLBACK"
        ? AgentRunStatus.FALLBACK
        : AgentRunStatus.FAILED,
    provider: execResult.provider,
    fallbackReason: execResult.fallbackReason,
    durationMs: execResult.durationMs,
    trace: {
      pipeline: ["load_project", "structure_capture", "keyword_retrieve", "atomic_save"],
      cardType: draft.type,
      linkedCardIds: links.map((link) => link.relatedCardId),
      keywordCount: draft.keywords.length,
    },
  });
  return saved;
}
