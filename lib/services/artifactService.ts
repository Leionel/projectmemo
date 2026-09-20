import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { generateArtifactWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { cardToDraft, generateMockArtifactWithClaims } from "@/lib/generators/templates";
import { saveArtifact } from "@/lib/repositories/artifacts";
import { requireProject } from "@/lib/repositories/projects";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { saveAgentRun } from "@/lib/repositories/agent";
import type { AgentExecutionResult, ArtifactTypeValue } from "@/lib/types";
import type { EpisodeSourceRef } from "@/lib/types/episode";
import { artifactContentSchema } from "@/lib/validation/schemas";

async function loadArtifactContext(projectId: string, episodeId?: string) {
  const project = await requireProject(projectId);
  // R2-5：指定已确认检查点时，范围与证据快照只来自该检查点冻结的来源
  let scopedCardIds: string[] | null = null;
  let scopedSourceRefs: Array<{ cardId: string; observedAt: string; titleSnapshot: string; summarySnapshot: string }> | null = null;
  let episodeTag: { episodeId: string; revisionId: string } | null = null;
  if (episodeId) {
    const episode = await db.projectEpisode.findFirst({
      where: { id: episodeId, projectId },
      include: { revisions: { orderBy: { revision: "asc" } } },
    });
    if (!episode) throw new AppError("EPISODE_NOT_FOUND", "阶段检查点不存在或不属于当前项目", 404);
    const published = [...episode.revisions].reverse().find((revision) => revision.status === "PUBLISHED");
    if (!published) throw new AppError("EPISODE_NOT_PUBLISHED", "该检查点还没有已确认版本，不能作为成果范围", 409);
    const refs = published.sourceRefs as unknown as EpisodeSourceRef[];
    const usable = refs.filter((ref) => ref.kind === "CARD" || ref.kind === "ACTION_RESULT");
    scopedCardIds = [...new Set(usable.map((ref) => ref.entityId))];
    if (scopedCardIds.length === 0) throw new AppError("EPISODE_SCOPE_EMPTY", "该检查点没有可用的记录来源，请先重新整理", 400);
    scopedSourceRefs = usable.map((ref) => ({
      cardId: ref.entityId,
      observedAt: ref.observedAt,
      titleSnapshot: ref.title,
      summarySnapshot: "",
    }));
    episodeTag = { episodeId: episode.id, revisionId: published.id };
  }

  const rawCards = await db.knowledgeCard.findMany({
    where: { projectId, ...(scopedCardIds ? { id: { in: scopedCardIds } } : {}) },
    orderBy: { createdAt: "asc" },
  });
  if (!rawCards.length) throw new AppError("NO_KNOWLEDGE_CARDS", "请先输入至少一条项目记录，再生成成果", 400);
  if (scopedSourceRefs) {
    const summaryById = new Map(rawCards.map((card) => [card.id, card.summary]));
    for (const ref of scopedSourceRefs) ref.summarySnapshot = summaryById.get(ref.cardId) ?? "";
  }
  return {
    project,
    episodeTag,
    cards: rawCards.map((card) => ({ ...cardToDraft(card), id: card.id })),
    // 生成时的证据引用快照：固化 cardId、观察时间与当时摘要，供事后逐句回溯审计
    sourceRefs: scopedSourceRefs ?? rawCards.map((card) => ({
      cardId: card.id,
      observedAt: new Date().toISOString(),
      titleSnapshot: card.title,
      summarySnapshot: card.summary,
    })),
  };
}

export async function generateArtifact(projectId: string, artifactType: ArtifactTypeValue, options?: { episodeId?: string }) {
  const { project, cards, sourceRefs, episodeTag } = await loadArtifactContext(projectId, options?.episodeId);
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
      ...(episodeTag ? { episodeId: episodeTag.episodeId, episodeRevisionId: episodeTag.revisionId, scope: "EPISODE_CHECKPOINT" } : {}),
    },
    resultJson: { artifactId: artifact.id, artifactType },
  });
  return artifact;
}

export async function saveEditedArtifactVersion(projectId: string, artifactType: ArtifactTypeValue, content: string) {
  await loadArtifactContext(projectId);
  return saveArtifact(projectId, artifactType, artifactContentSchema.parse(content));
}
