import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";
import { finishExternalAgentRun, getProjectMetrics, listActions, listInterventions, reserveExternalAgentRun } from "@/lib/repositories/agent";
import { getProjectDetail, requireProject } from "@/lib/repositories/projects";
import { evaluateProjectContext } from "@/lib/services/agentContextService";
import { listProjectMilestones } from "@/lib/services/milestoneService";
import { inspectProjectResponseSchema, type InspectProjectInput } from "@/lib/xiaoyi/contracts";
import { externalRequestId, parseStoredResponse, safeXiaoyiError, throwStoredFailure, XIAOYI_PROVIDER } from "@/lib/xiaoyi/receipts";

function parseExpectedEvidence(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function inspectProjectFromXiaoyi(input: {
  projectId: string;
  requestId: string;
  payload: InspectProjectInput;
}) {
  const startedAt = Date.now();
  const project = await requireProject(input.projectId);
  const receiptId = externalRequestId("inspect_project", "call", input.requestId);
  const reservation = await reserveExternalAgentRun({
    projectId: project.id,
    runType: AgentRunType.EVALUATE,
    provider: XIAOYI_PROVIDER,
    externalRequestId: receiptId,
    trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "inspect_project", stage: "RECEIVED", requestId: input.requestId, refresh: input.payload.refresh },
  });

  if (!reservation.created) {
    const response = parseStoredResponse(inspectProjectResponseSchema, reservation.run.resultJson);
    if (response) return { response: { ...response, replayed: true }, status: 200 };
    if (reservation.run.status === AgentRunStatus.FAILED) throwStoredFailure(reservation.run.resultJson);
    throw new AppError("XIAOYI_REQUEST_IN_PROGRESS", "相同 request_id 的调用仍在处理中", 409);
  }

  try {
    if (input.payload.refresh && isFeatureEnabled("DELIVERABLE_GAP_ENABLED", true)) {
      await evaluateProjectContext(project.id);
    }
    const [detail, metrics, interventions, actions, milestones] = await Promise.all([
      getProjectDetail(project.id),
      getProjectMetrics(project.id),
      listInterventions(project.id, false),
      listActions(project.id, false),
      listProjectMilestones(project.id),
    ]);
    // 只读聚合：播报顺序为变化 → 风险/未知 → 下一行动 → 已安排时间；失败不阻断 inspect 主体
    let reentrySection: unknown = null;
    if (isFeatureEnabled("PROJECT_REENTRY_ENABLED", false)) {
      try {
        const { getProjectReentry } = await import("@/lib/services/projectReentryService");
        reentrySection = await getProjectReentry(project.id);
      } catch (reentryError) {
        reentrySection = { status: "FAILED", errorCode: reentryError instanceof AppError ? reentryError.code : "REENTRY_SECTION_FAILED" };
      }
    }
    const response = {
      ok: true as const,
      request_id: input.requestId,
      agent_run_id: reservation.run.id,
      project: {
        id: detail.id,
        title: detail.title,
        description: detail.description,
        goal: detail.goal,
        scenario: detail.scenario,
        deadline: detail.deadline?.toISOString() ?? null,
        updated_at: detail.updatedAt.toISOString(),
      },
      state: {
        metrics,
        data_time: new Date().toISOString(),
        open_intervention_count: interventions.filter((item) => item.status === "OPEN").length,
        open_action_count: actions.filter((item) => item.status === "TODO" || item.status === "DOING").length,
      },
      interventions: interventions.map((item) => ({
        id: item.id,
        trigger_type: item.triggerType,
        severity: item.severity,
        status: item.status,
        title: item.title,
        content: item.content,
        is_simulated: item.isSimulated,
        evidence: item.evidence,
      })),
      actions: actions.map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        priority: item.priority,
        due_at: item.dueAt?.toISOString() ?? null,
        source_intervention_id: item.sourceInterventionId,
        source_card_id: item.sourceCardId,
      })),
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        target_date: milestone.targetDate?.toISOString() ?? null,
        deliverables: milestone.deliverables.map((deliverable) => {
          const expectedEvidence = parseExpectedEvidence(deliverable.expectedEvidence);
          const missingEvidence = getMissingEvidenceTypes(expectedEvidence, deliverable.evidences);
          return {
            id: deliverable.id,
            title: deliverable.title,
            status: deliverable.status,
            expected_evidence: expectedEvidence,
            missing_evidence: missingEvidence,
            evidences: deliverable.evidences.map((evidence) => ({
              id: evidence.id,
              evidence_type: evidence.evidenceType,
              card_id: evidence.cardId,
              attachment_id: evidence.attachmentId,
              confirmed: evidence.confirmed,
            })),
          };
        }),
      })),
      replayed: false,
      reentry: reentrySection,
    };
    await finishExternalAgentRun({
      runId: reservation.run.id,
      status: AgentRunStatus.SUCCESS,
      durationMs: Date.now() - startedAt,
      resultJson: response,
      trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "inspect_project", stage: "COMPLETED", requestId: input.requestId, milestoneCount: milestones.length, interventionCount: interventions.length, actionCount: actions.length },
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
        trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "inspect_project", stage: "FAILED", requestId: input.requestId, errorCode: safe.code },
      });
    } catch (auditError) {
      console.error("Failed to persist Xiaoyi inspect_project failure receipt", auditError);
    }
    throw error instanceof AppError ? error : new AppError(safe.code, safe.message, safe.status);
  }
}
