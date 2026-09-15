import { stableStringify, sha256Hex } from "@/lib/projectState/buildSnapshot";
import { requireProject } from "@/lib/repositories/projects";
import { loadRecentCards, saveCaptureResult } from "@/lib/repositories/cards";
import { structureCaptureWithMeta } from "@/lib/agent";
import { KeywordVectorStore } from "@/lib/memory/vectorStore";
import { ensureCardEmbedding } from "@/lib/repositories/embeddings";
import { isFeatureEnabled } from "@/lib/config/features";
import {
  AgentRunStatus,
  AgentRunType,
  Prisma,
} from "@/lib/generated/prisma/client";
import {
  finishExternalAgentRun,
  reserveExternalAgentRun,
  saveAgentRun,
} from "@/lib/repositories/agent";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import type { CardLink } from "@/lib/types";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";

const vectorStore = new KeywordVectorStore();
const CAPTURE_API_PROVIDER = "capture-api";

type SavedCapture = Awaited<ReturnType<typeof saveCaptureResult>>;

export interface IdempotentCaptureResult {
  card: SavedCapture;
  replayed: boolean;
  postProcessingPending: boolean;
  stateRefreshPending: boolean;
  agentRunId: string;
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function captureRequestPayloadHash(rawText: string, sourceType?: string | null): string {
  return sha256Hex(stableStringify({ rawText, sourceType: sourceType ?? null }));
}

function runTrace(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function safeError(error: unknown) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: "CAPTURE_FAILED", message: "记录处理失败，请保留原文后重试", status: 500 };
}

async function loadCardById(projectId: string, cardId: string): Promise<SavedCapture> {
  const card = await db.knowledgeCard.findFirst({ where: { id: cardId, projectId } });
  if (!card) {
    throw new AppError("CAPTURE_RESULT_MISSING", "记录已保存但结果回执暂不可用，请稍后重试查看", 503);
  }
  return { ...card, relations: [] as CardLink[] } as SavedCapture;
}

async function runPostProcessing(saved: SavedCapture): Promise<boolean> {
  let pending = false;
  try {
    await vectorStore.index({
      id: saved.id,
      title: saved.title,
      keywords: saved.keywords as string[],
    });
  } catch (error) {
    pending = true;
    console.warn("Capture saved; vector index refresh is pending", error);
  }

  if (isFeatureEnabled("SEMANTIC_MEMORY_ENABLED", false)) {
    try {
      await ensureCardEmbedding({
        id: saved.id,
        title: saved.title,
        summary: saved.summary,
        keywords: saved.keywords,
      });
    } catch (error) {
      pending = true;
      // Embedding failure must not roll back a valid Capture. Search keeps its
      // keyword fallback and a later backfill can retry this card.
      console.warn("Card embedding failed; keeping captured memory searchable by keyword", error);
    }
  }
  return pending;
}

/**
 * 状态快照是保存事实后的派生读模型：刷新失败不能回滚刚保存的记录，
 * 也不能让捕获接口诱导用户用新 requestId 重复建卡。失败由 freshness 回执
 * 持久化，调用方只收到“状态待刷新”的附加标记。
 */
async function refreshStateAfterCapture(projectId: string): Promise<boolean> {
  return refreshProjectStateAfterMutation(projectId);
}

/**
 * 兼容旧调用方的记录流程：没有 requestId 时保持原有返回类型和写入行为。
 * 需要重试/恢复语义的 API 调用请使用 processCaptureWithRequest。
 */
export async function processCapture(projectId: string, rawText: string, sourceType?: string | null) {
  const project = await requireProject(projectId);
  const existingCards = await loadRecentCards(projectId);
  const historyKeywords = [...new Set(existingCards.flatMap((card) => card.keywords))].slice(0, 30);

  const execResult = await structureCaptureWithMeta({ project, rawText, historyKeywords });
  const draft = execResult.data;
  const links = await vectorStore.search(draft, existingCards, 3);
  const saved = await saveCaptureResult({ projectId, rawText, sourceType, draft, links });
  await runPostProcessing(saved);
  await refreshStateAfterCapture(projectId);

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

interface CaptureRequestOptions {
  requestId: string;
  provider?: string;
}

async function waitForExistingCaptureRun(projectId: string, runId: string, requestHash: string) {
  for (let attempt = 0; attempt < 1200; attempt += 1) {
    const run = await db.agentRun.findFirst({ where: { id: runId, projectId } });
    if (!run) throw new AppError("CAPTURE_RESULT_MISSING", "记录回执不存在，请使用新的 requestId 重试", 503);
    const trace = runTrace(run.trace);
    if (trace.requestHash && trace.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "同一 requestId 已绑定其他记录内容，请保留原文或使用新的 requestId", 409);
    }
    const result = run.resultJson && typeof run.resultJson === "object" && !Array.isArray(run.resultJson)
      ? run.resultJson as Record<string, unknown>
      : {};
    if ((run.status === AgentRunStatus.SUCCESS || run.status === AgentRunStatus.FALLBACK) && typeof result.cardId === "string") {
      const card = await loadCardById(projectId, result.cardId);
      return {
        card,
        replayed: true,
        postProcessingPending: result.postProcessingPending === true,
        stateRefreshPending: result.stateRefreshPending === true,
        agentRunId: run.id,
      } satisfies IdempotentCaptureResult;
    }
    if (run.status === AgentRunStatus.FAILED) {
      const error = result.error && typeof result.error === "object" ? result.error as Record<string, unknown> : {};
      throw new AppError(
        typeof error.code === "string" ? error.code : "CAPTURE_FAILED",
        typeof error.message === "string" ? error.message : "记录处理失败，请保留原文后重试",
        typeof error.status === "number" ? error.status : 409,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new AppError("CAPTURE_IN_PROGRESS", "相同 requestId 的记录仍在处理中，请稍后按原 ID 重试", 409);
}

/**
 * 带持久化 requestId 的记录流程。
 *
 * 模型抽取和检索在事务外执行；Capture、KnowledgeCard 与 AgentRun 完成
 * 回执在同一短事务内提交。重复请求只读取首次业务结果，payload 改变则
 * 返回 409，避免客户端因响应丢失而重复建卡。
 */
export async function processCaptureWithRequest(
  projectId: string,
  rawText: string,
  sourceType: string | null | undefined,
  options: CaptureRequestOptions,
): Promise<IdempotentCaptureResult> {
  const project = await requireProject(projectId);
  const payloadHash = captureRequestPayloadHash(rawText, sourceType);
  const provider = options.provider ?? CAPTURE_API_PROVIDER;
  const reservation = await reserveExternalAgentRun({
    projectId,
    runType: AgentRunType.CAPTURE,
    provider,
    // AgentRun 的唯一约束是 (provider, externalRequestId)，而 requestId
    // 的业务作用域是项目内；持久化回执键必须显式带上项目，避免两个项目
    // 恰好使用同一客户端 ID 时互相读到对方的回执。
    externalRequestId: `${projectId}:${options.requestId}`,
    trace: {
      source: "capture",
      provider,
      stage: "RECEIVED",
      requestId: options.requestId,
      requestHash: payloadHash,
      sourceType: sourceType ?? null,
      contentLength: rawText.length,
    },
  });

  if (!reservation.created) {
    const trace = runTrace(reservation.run.trace);
    if (trace.requestHash && trace.requestHash !== payloadHash) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "同一 requestId 已绑定其他记录内容，请保留原文或使用新的 requestId", 409);
    }
    return waitForExistingCaptureRun(projectId, reservation.run.id, payloadHash);
  }

  const startedAt = Date.now();
  try {
    const existingCards = await loadRecentCards(projectId);
    const historyKeywords = [...new Set(existingCards.flatMap((card) => card.keywords))].slice(0, 30);
    const execResult = await structureCaptureWithMeta({ project, rawText, historyKeywords });
    const draft = execResult.data;
    const links = await vectorStore.search(draft, existingCards, 3);

    let saved: SavedCapture;
    try {
      saved = await db.$transaction(async (tx) => {
        const card = await saveCaptureResult({
          projectId,
          rawText,
          sourceType,
          requestId: options.requestId,
          requestHash: payloadHash,
          draft,
          links,
        }, tx);
        await tx.agentRun.update({
          where: { id: reservation.run.id },
          data: {
            status: execResult.status === "FALLBACK" ? AgentRunStatus.FALLBACK : AgentRunStatus.SUCCESS,
            fallbackReason: execResult.fallbackReason ?? null,
            durationMs: Date.now() - startedAt,
            trace: {
              source: "capture",
              provider,
              stage: "COMPLETED",
              requestId: options.requestId,
              requestHash: payloadHash,
              cardId: card.id,
              linkedCardIds: links.map((link) => link.relatedCardId),
              cardType: draft.type,
              keywordCount: draft.keywords.length,
            } as unknown as Prisma.InputJsonValue,
            resultJson: {
              cardId: card.id,
              requestId: options.requestId,
              postProcessingPending: false,
            } as unknown as Prisma.InputJsonValue,
          },
        });
        return card;
      });
    } catch (error) {
      // A different process using the same project/requestId may have won the
      // Capture unique constraint before this transaction reached the insert.
      if (isUniqueConstraintError(error)) {
        const existing = await db.capture.findFirst({
          where: { projectId, requestId: options.requestId },
          include: { card: true },
        });
        if (existing) {
          if (existing.requestHash !== payloadHash) {
            throw new AppError("IDEMPOTENCY_CONFLICT", "同一 requestId 已绑定其他记录内容，请保留原文或使用新的 requestId", 409);
          }
          if (existing.card) {
            const card = await loadCardById(projectId, existing.card.id);
            return { card, replayed: true, postProcessingPending: false, stateRefreshPending: false, agentRunId: reservation.run.id };
          }
        }
      }
      throw error;
    }

    const postProcessingPending = await runPostProcessing(saved);
    const stateRefreshPending = await refreshStateAfterCapture(projectId);
    if (postProcessingPending) {
      try {
        await db.agentRun.update({
          where: { id: reservation.run.id },
          data: {
            resultJson: {
              cardId: saved.id,
              requestId: options.requestId,
              postProcessingPending: true,
              stateRefreshPending,
            } as unknown as Prisma.InputJsonValue,
            trace: {
              source: "capture",
              provider,
              stage: "SAVED_POSTPROCESS_PENDING",
              requestId: options.requestId,
              requestHash: payloadHash,
              cardId: saved.id,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        console.warn("Capture saved; failed to update post-processing receipt", error);
      }
    }
    if (!postProcessingPending) {
      try {
        await db.agentRun.update({
          where: { id: reservation.run.id },
          data: {
            resultJson: {
              cardId: saved.id,
              requestId: options.requestId,
              postProcessingPending: false,
              stateRefreshPending,
            } as unknown as Prisma.InputJsonValue,
            trace: {
              source: "capture",
              provider,
              stage: stateRefreshPending ? "SAVED_STATE_REFRESH_PENDING" : "COMPLETED",
              requestId: options.requestId,
              requestHash: payloadHash,
              cardId: saved.id,
            } as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (error) {
        console.warn("Capture saved; failed to update state refresh receipt", error);
      }
    }
    return { card: saved, replayed: false, postProcessingPending, stateRefreshPending, agentRunId: reservation.run.id };
  } catch (error) {
    const safe = safeError(error);
    try {
      await finishExternalAgentRun({
        runId: reservation.run.id,
        status: AgentRunStatus.FAILED,
        durationMs: Date.now() - startedAt,
        fallbackReason: safe.code,
        resultJson: { error: safe },
        trace: {
          source: "capture",
          provider,
          stage: "FAILED",
          requestId: options.requestId,
          requestHash: payloadHash,
          errorCode: safe.code,
        },
      });
    } catch (receiptError) {
      console.error("Failed to persist capture failure receipt", receiptError);
    }
    throw error instanceof AppError ? error : new AppError(safe.code, safe.message, safe.status);
  }
}
