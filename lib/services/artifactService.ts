import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { generateArtifactWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { cardToDraft, generateMockArtifactWithClaims } from "@/lib/generators/templates";
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
  return {
    project,
    cards: rawCards.map((card) => ({ ...cardToDraft(card), id: card.id })),
    // 生成时的证据引用快照：固化 cardId、观察时间与当时摘要，供事后逐句回溯审计
    sourceRefs: rawCards.map((card) => ({
      cardId: card.id,
      observedAt: new Date().toISOString(),
      titleSnapshot: card.title,
      summarySnapshot: card.summary,
    })),
  };
}

export async function generateArtifact(projectId: string, artifactType: ArtifactTypeValue) {
  const { project, cards, sourceRefs } = await loadArtifactContext(projectId);
  const startedAt = Date.now();
  const mock = generateMockArtifactWithClaims(artifactType, { project, cards });
  // 模板绑定的逐句映射：模板路径自带，模型路径暂无映射（语义未核验，audit 明确标注）
  let claims: { status: "TEMPLATE_BOUND" | "UNMAPPED_MODEL"; claims: typeof mock.claims } = {
    status: "TEMPLATE_BOUND",
    claims: mock.claims,
  };
  let execution: AgentExecutionResult<string> = {
    data: mock.content,
    provider: "mock",
    status: "SUCCESS" as const,
    fallbackReason: null as string | null,
    durationMs: 0,
  };
  if (process.env.LLM_MODE === "openai-compatible" && process.env.LLM_API_KEY) {
    try {
      const remote = await generateArtifactWithLLMWithMeta({ project, artifactType, cards });
      execution = { ...remote, data: artifactContentSchema.parse(remote.data) };
      claims = { status: "UNMAPPED_MODEL", claims: [] };
    } catch (error) {
      console.warn("LLM artifact generation failed; using mock template", error);
      execution = {
        data: mock.content,
        provider: "mock-fallback",
        status: "FALLBACK",
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : "llm_error",
        durationMs: Date.now() - startedAt,
      };
    }
  }
  const artifact = await saveArtifact(
    projectId,
    artifactType,
    execution.data,
    sourceRefs,
    claims as unknown as Parameters<typeof saveArtifact>[4],
  );
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
