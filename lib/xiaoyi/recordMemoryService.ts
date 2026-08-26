import { AppError } from "@/lib/api";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { finishExternalAgentRun, reserveExternalAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { processCapture } from "@/lib/services/captureService";
import { recordMemoryResponseSchema, type RecordMemoryInput, type RecordMemoryResponse } from "@/lib/xiaoyi/contracts";

const XIAOYI_PROVIDER = "xiaoyi-workflow";

function safeError(error: unknown) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status };
  }
  return { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试", status: 500 };
}

function storedResponse(value: unknown): RecordMemoryResponse | null {
  const parsed = recordMemoryResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export async function recordMemoryFromXiaoyi(input: {
  projectId: string;
  requestId: string;
  payload: RecordMemoryInput;
}) {
  const startedAt = Date.now();
  const project = await requireProject(input.projectId);
  const reservation = await reserveExternalAgentRun({
    projectId: project.id,
    runType: AgentRunType.CAPTURE,
    provider: XIAOYI_PROVIDER,
    externalRequestId: input.requestId,
    trace: {
      stage: "RECEIVED",
      tool: "record_memory",
      externalRequestId: input.requestId,
      contentLength: input.payload.content.length,
    },
  });

  if (!reservation.created) {
    const response = storedResponse(reservation.run.resultJson);
    if (response) return { response: { ...response, replayed: true }, status: 200 };
    if (reservation.run.status === AgentRunStatus.FAILED) {
      const value = reservation.run.resultJson as { error?: { code?: string; message?: string; status?: number } } | null;
      throw new AppError(
        value?.error?.code ?? "XIAOYI_REQUEST_FAILED",
        value?.error?.message ?? "该 request_id 对应的调用已经失败，请使用新的 request_id 重试",
        value?.error?.status ?? 409,
      );
    }
    throw new AppError("XIAOYI_REQUEST_IN_PROGRESS", "相同 request_id 的调用仍在处理中", 409);
  }

  try {
    const card = await processCapture(project.id, input.payload.content, input.payload.source_type);
    const response: RecordMemoryResponse = {
      ok: true,
      request_id: input.requestId,
      agent_run_id: reservation.run.id,
      project_title: project.title,
      card_id: card.id,
      title: card.title,
      summary: card.summary,
      source_type: input.payload.source_type,
      created_at: card.createdAt.toISOString(),
      replayed: false,
    };
    await finishExternalAgentRun({
      runId: reservation.run.id,
      status: AgentRunStatus.SUCCESS,
      durationMs: Date.now() - startedAt,
      resultJson: response,
      trace: {
        stage: "COMPLETED",
        tool: "record_memory",
        externalRequestId: input.requestId,
        cardId: card.id,
        sourceType: input.payload.source_type,
        contentLength: input.payload.content.length,
      },
    });
    return { response, status: 201 };
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
          stage: "FAILED",
          tool: "record_memory",
          externalRequestId: input.requestId,
          errorCode: safe.code,
          contentLength: input.payload.content.length,
        },
      });
    } catch (auditError) {
      console.error("Failed to persist Xiaoyi failure receipt", auditError);
    }
    throw error instanceof AppError ? error : new AppError(safe.code, safe.message, safe.status);
  }
}
