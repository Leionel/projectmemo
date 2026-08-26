import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { generateArtifactWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { cardToDraft, generateMockArtifact } from "@/lib/generators/templates";
import { saveArtifact } from "@/lib/repositories/artifacts";
import { requireProject } from "@/lib/repositories/projects";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { saveAgentRun } from "@/lib/repositories/agent";
import type { AgentExecutionResult, ArtifactTypeValue } from "@/lib/types";
import { artifactContentSchema } from "@/lib/validation/schemas";

async function loadArtifactContext(projectId: string) {
  const project = await requireProject(projectId);
  const rawCards = await db.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  if (!rawCards.length) throw new AppError("NO_KNOWLEDGE_CARDS", "请先输入至少一条项目记录，再生成成果", 400);
  return { project, cards: rawCards.map(cardToDraft) };
}

export async function generateArtifact(projectId: string, artifactType: ArtifactTypeValue) {
  const { project, cards } = await loadArtifactContext(projectId);
  const startedAt = Date.now();
  let execution: AgentExecutionResult<string> = {
    data: generateMockArtifact(artifactType, { project, cards }),
    provider: "mock",
    status: "SUCCESS" as const,
    fallbackReason: null as string | null,
    durationMs: 0,
  };
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      const remote = await generateArtifactWithLLMWithMeta({ project, artifactType, cards });
      execution = { ...remote, data: artifactContentSchema.parse(remote.data) };
    } catch (error) {
      console.warn("LLM artifact generation failed; using mock template", error);
      execution = {
        data: generateMockArtifact(artifactType, { project, cards }),
        provider: "mock-fallback",
        status: "FALLBACK",
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : "llm_error",
        durationMs: Date.now() - startedAt,
      };
    }
  }
  const artifact = await saveArtifact(projectId, artifactType, execution.data);
  await saveAgentRun({
    projectId,
    runType: AgentRunType.ARTIFACT,
    status: execution.status === "SUCCESS" ? AgentRunStatus.SUCCESS : AgentRunStatus.FALLBACK,
    provider: execution.provider,
    fallbackReason: execution.fallbackReason,
    durationMs: Date.now() - startedAt,
    trace: {
      pipeline: ["load_project", "load_memory", "generate_artifact", "save_version"],
      artifactType,
      artifactId: artifact.id,
      cardCount: cards.length,
    },
    resultJson: { artifactId: artifact.id, artifactType },
  });
  return artifact;
}

export async function saveEditedArtifactVersion(projectId: string, artifactType: ArtifactTypeValue, content: string) {
  await loadArtifactContext(projectId);
  return saveArtifact(projectId, artifactType, artifactContentSchema.parse(content));
}
