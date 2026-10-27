import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import { generateArtifactWithLLMWithMeta } from "@/lib/agent/llmAgent";
import { cardToDraft, generateMockArtifactWithClaims } from "@/lib/generators/templates";
import { saveArtifact, saveArtifactInTx } from "@/lib/repositories/artifacts";
import { requireProject } from "@/lib/repositories/projects";
import { AgentRunStatus, AgentRunType, type Prisma } from "@/lib/generated/prisma/client";
import type { AgentExecutionResult, ArtifactTypeValue } from "@/lib/types";
import type { EpisodeSourceRef } from "@/lib/types/episode";
import { artifactContentSchema } from "@/lib/validation/schemas";
import { readReviewMaterial } from "@/lib/mission/projectMaterialReader";
import { artifactCoverageV2 } from "@/lib/agent/specialistPrompts";

async function loadArtifactContext(projectId: string, episodeId?: string) {
  const project = await requireProject(projectId);
  // R2-5：指定已确认检查点时，范围与证据快照只来自该检查点冻结的来源
  let scopedCardIds: string[] | null = null;
  let scopedSourceRefs: Array<{ cardId: string; observedAt: string; titleSnapshot: string; summarySnapshot: string; revisionHash: string }> | null = null;
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
      summarySnapshot: ref.summary,
      revisionHash: ref.contentHash,
    }));
    episodeTag = { episodeId: episode.id, revisionId: published.id };
  }

  const totalCards = await db.knowledgeCard.count({ where: { projectId, ...(scopedCardIds ? { id: { in: scopedCardIds } } : {}) } });
  const rawCards = (await db.knowledgeCard.findMany({
    where: { projectId, ...(scopedCardIds ? { id: { in: scopedCardIds } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 24,
  })).reverse();
  if (!rawCards.length) throw new AppError("NO_KNOWLEDGE_CARDS", "请先输入至少一条项目记录，再生成成果", 400);
  const sources = await Promise.all(rawCards.map(async card => {
    const frozen = scopedSourceRefs?.find(ref => ref.cardId === card.id);
    if (frozen) return { cardId: card.id, sourceId: "card:" + card.id, revision: frozen.revisionHash, readScope: "FROZEN_SUMMARY",
      text: frozen.titleSnapshot + "\n" + frozen.summarySnapshot, truncated: false, temporalState: "UNKNOWN" };
    const id = card.captureId ? "capture:" + card.captureId : card.attachmentId ? "attachment:" + card.attachmentId : "card:" + card.id;
    const material = await readReviewMaterial(projectId, id);
    return { cardId: card.id, sourceId: id, revision: material?.source.hash ?? null,
      readScope: material?.readScope ?? "SUMMARY", text: material?.source.text.slice(0, 2000) ?? card.summary,
      truncated: (material?.source.text.length ?? card.summary.length) > 2000, temporalState: material?.source.temporalState ?? "UNKNOWN" };
  }));
  return {
    project,
    episodeTag,
    cards: rawCards.map((card) => { const frozen = scopedSourceRefs?.find(ref => ref.cardId === card.id); return { ...cardToDraft(card), id: card.id,
      ...(frozen ? { title: frozen.titleSnapshot, summary: frozen.summarySnapshot, keywords: [], relatedTasks: [], nextActions: [] } : {}) }; }),
    sources, coverage: { loadedCards: rawCards.length, totalCards: scopedCardIds?.length ?? totalCards, complete: false,
      policy: episodeTag ? "FROZEN_EPISODE_SUMMARIES" : "LATEST_24_CARDS_WITH_BOUNDED_SOURCE_EXCERPTS" },
    // 生成时的证据引用快照：固化 cardId、观察时间与当时摘要，供事后逐句回溯审计
    sourceRefs: scopedSourceRefs?.filter(ref => rawCards.some(card => card.id === ref.cardId)) ?? rawCards.map((card) => ({
      cardId: card.id,
      observedAt: new Date().toISOString(),
      titleSnapshot: card.title,
      summarySnapshot: card.summary,
    })),
  };
}

/** Preparation can call the model; it must stay outside the final business transaction. */
export async function prepareArtifactGeneration(projectId: string, artifactType: ArtifactTypeValue, options?: { episodeId?: string }) {
  const { project, cards, sourceRefs, episodeTag, sources, coverage } = await loadArtifactContext(projectId, options?.episodeId);
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
    let received: AgentExecutionResult<string> | undefined;
    try {
      const remote = received = await generateArtifactWithLLMWithMeta({ project, artifactType, cards, sources, coverage });
      if (remote.status === "FAILED") throw new AppError(remote.fallbackReason ?? "MODEL_RESPONSE_INVALID", "成果草稿生成未完成", 503);
      execution = { ...remote, data: artifactContentSchema.parse(remote.data) };
      claims = { status: "UNMAPPED_MODEL", claims: [] };
    } catch (error) {
      console.warn("LLM artifact generation failed; using mock template", error);
      execution = {
        ...received,
        prompt: { id: artifactCoverageV2.id, version: artifactCoverageV2.version, purpose: artifactCoverageV2.purpose, outputSchemaVersion: artifactCoverageV2.outputSchemaVersion },
        usageUnknown: received?.usageUnknown ?? true,
        data: mock.content,
        provider: "mock-fallback",
        status: "FALLBACK",
        fallbackReason: error instanceof Error ? error.message.slice(0, 240) : "llm_error",
        durationMs: Date.now() - startedAt,
      };
    }
  }
  return {
    projectId,
    artifactType,
    content: execution.data,
    sourceRefs,
    claims,
    audit: {
      status: execution.status === "SUCCESS" ? AgentRunStatus.SUCCESS : AgentRunStatus.FALLBACK,
      provider: execution.provider,
      fallbackReason: execution.fallbackReason,
      durationMs: Date.now() - startedAt,
      trace: {
      pipeline: ["load_project", "load_memory", "generate_artifact", "save_version"],
      artifactType,
      cardCount: cards.length,
      coverage, sourcePointers: sources.map(s => ({ sourceId: s.sourceId, revision: s.revision, readScope: s.readScope, truncated: s.truncated })),
      prompt: execution.prompt ?? null, usage: execution.usage ?? null, usageUnknown: execution.usageUnknown ?? null, requestIdentity: execution.requestIdentity ?? null,
      ...(episodeTag ? { episodeId: episodeTag.episodeId, episodeRevisionId: episodeTag.revisionId, scope: "EPISODE_CHECKPOINT" } : {}),
      },
    },
  };
}

export async function savePreparedArtifactInTx(tx: Prisma.TransactionClient, prepared: Awaited<ReturnType<typeof prepareArtifactGeneration>>) {
  const artifact = await saveArtifactInTx(tx, prepared.projectId, prepared.artifactType, prepared.content,
    prepared.sourceRefs, prepared.claims as unknown as Prisma.InputJsonValue);
  await tx.agentRun.create({ data: {
    projectId: prepared.projectId,
    runType: AgentRunType.ARTIFACT,
    ...prepared.audit,
    trace: { ...prepared.audit.trace, artifactId: artifact.id },
    resultJson: { artifactId: artifact.id, artifactType: prepared.artifactType },
  } });
  return artifact;
}

export async function generateArtifact(projectId: string, artifactType: ArtifactTypeValue, options?: { episodeId?: string }) {
  const prepared = await prepareArtifactGeneration(projectId, artifactType, options);
  return db.$transaction(tx => savePreparedArtifactInTx(tx, prepared));
}

export async function saveEditedArtifactVersion(projectId: string, artifactType: ArtifactTypeValue, content: string) {
  await loadArtifactContext(projectId);
  return saveArtifact(projectId, artifactType, artifactContentSchema.parse(content));
}
