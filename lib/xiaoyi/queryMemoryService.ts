import { AppError } from "@/lib/api";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { isFeatureEnabled } from "@/lib/config/features";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import type { KnowledgeTypeValue } from "@/lib/types";
import { finishExternalAgentRun, reserveExternalAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import {
  queryMemoryResponseSchema,
  type QueryMemoryInput,
  type QueryMemoryResponse,
} from "@/lib/xiaoyi/contracts";
import { externalRequestId, parseStoredResponse, safeXiaoyiError, throwStoredFailure, XIAOYI_PROVIDER } from "@/lib/xiaoyi/receipts";

export async function queryMemoryFromXiaoyi(input: {
  projectId: string;
  requestId: string;
  payload: QueryMemoryInput;
}) {
  const startedAt = Date.now();
  const project = await requireProject(input.projectId);
  const receiptId = externalRequestId("query_memory", "call", input.requestId);
  const reservation = await reserveExternalAgentRun({
    projectId: project.id,
    runType: AgentRunType.CHAT,
    provider: XIAOYI_PROVIDER,
    externalRequestId: receiptId,
    trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "query_memory", stage: "RECEIVED", requestId: input.requestId },
  });

  if (!reservation.created) {
    const response = parseStoredResponse(queryMemoryResponseSchema, reservation.run.resultJson);
    if (response) return { response: { ...response, replayed: true }, status: 200 };
    if (reservation.run.status === AgentRunStatus.FAILED) throwStoredFailure(reservation.run.resultJson);
    throw new AppError("XIAOYI_REQUEST_IN_PROGRESS", "相同 request_id 的调用仍在处理中", 409);
  }

  try {
    const results = await searchProjectCards({
      projectId: project.id,
      query: input.payload.query,
      limit: input.payload.top_k ?? input.payload.limit ?? 8,
      typeFilter: input.payload.type as KnowledgeTypeValue | "all",
    });
    const semanticAvailable = results.length > 0 && results.every((result) => result.retrievalMode === "hybrid");
    const retrievalMode = semanticAvailable ? "hybrid" : "keyword_fallback";
    const response: QueryMemoryResponse = {
      ok: true,
      request_id: input.requestId,
      agent_run_id: reservation.run.id,
      query: input.payload.query,
      results: results.map((result) => ({
        card_id: result.cardId,
        title: result.title,
        summary: result.summary,
        type: result.type,
        score: result.score,
        reason: result.reason,
        source: result.source,
        retrieval_mode: result.retrievalMode,
        created_at: result.createdAt,
      })),
      retrieval_mode: retrievalMode,
      semantic_available: semanticAvailable && isFeatureEnabled("SEMANTIC_MEMORY_ENABLED", false),
      replayed: false,
    };
    await finishExternalAgentRun({
      runId: reservation.run.id,
      status: semanticAvailable ? AgentRunStatus.SUCCESS : AgentRunStatus.PARTIAL,
      durationMs: Date.now() - startedAt,
      resultJson: response,
      trace: {
        source: "xiaoyi",
        provider: XIAOYI_PROVIDER,
        tool: "query_memory",
        stage: "COMPLETED",
        requestId: input.requestId,
        resultCount: results.length,
        retrievalMode,
        semanticAvailable: response.semantic_available,
      },
    });
    return { response, status: 200 };
  } catch (error) {
    const safe = safeXiaoyiError(error);
    try {
      await finishExternalAgentRun({
        runId: reservation.run.id,
        status: AgentRunStatus.FAILED,
        durationMs: Date.now() - startedAt,
        fallbackReason: safe.code,
        resultJson: { error: safe },
        trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "query_memory", stage: "FAILED", requestId: input.requestId, errorCode: safe.code },
      });
    } catch (auditError) {
      console.error("Failed to persist Xiaoyi query_memory failure receipt", auditError);
    }
    throw error instanceof AppError ? error : new AppError(safe.code, safe.message, safe.status);
  }
}
