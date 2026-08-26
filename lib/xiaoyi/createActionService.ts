import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/api";
import { AgentRunStatus, AgentRunType } from "@/lib/generated/prisma/client";
import { createOrReuseAction, finishExternalAgentRun, reserveExternalAgentRun } from "@/lib/repositories/agent";
import { requireProject } from "@/lib/repositories/projects";
import { createActionResponseSchema, type CreateActionInput } from "@/lib/xiaoyi/contracts";
import { externalRequestId, parseStoredResponse, safeXiaoyiError, throwStoredFailure, XIAOYI_PROVIDER } from "@/lib/xiaoyi/receipts";

interface ActionProposal {
  v: 1;
  projectId: string;
  title: string;
  description: string | null;
  priority: number;
  dueAt: string | null;
  sourceInterventionId: string | null;
  sourceCardId: string | null;
  expiresAt: number;
  nonce: string;
}

function adapterSecret() {
  const secret = process.env.XIAOYI_ADAPTER_TOKEN?.trim() ?? "";
  if (secret.length < 32) throw new AppError("XIAOYI_ADAPTER_NOT_CONFIGURED", "小艺适配层配置不完整", 503);
  return secret;
}

function sign(body: string) {
  return createHmac("sha256", adapterSecret()).update(body).digest("base64url");
}

function issueProposal(proposal: ActionProposal) {
  const body = Buffer.from(JSON.stringify(proposal), "utf8").toString("base64url");
  return `${body}.${sign(body)}`;
}

function signatureMatches(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyProposal(token: string, projectId: string): ActionProposal {
  const [body, signature, ...rest] = token.split(".");
  if (!body || !signature || rest.length > 0 || !signatureMatches(signature, sign(body))) {
    throw new AppError("XIAOYI_PROPOSAL_INVALID", "行动提案签名无效", 422);
  }
  let proposal: ActionProposal;
  try {
    proposal = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ActionProposal;
  } catch {
    throw new AppError("XIAOYI_PROPOSAL_INVALID", "行动提案内容无效", 422);
  }
  if (proposal.v !== 1 || proposal.projectId !== projectId || !proposal.title || proposal.expiresAt <= Date.now()) {
    throw new AppError("XIAOYI_PROPOSAL_EXPIRED", "行动提案已过期或不属于当前项目", 422);
  }
  return proposal;
}

function proposalTtlMs() {
  const configured = Number.parseInt(process.env.XIAOYI_PROPOSAL_TTL_MS ?? "600000", 10);
  return Number.isFinite(configured) && configured >= 30_000 ? configured : 600_000;
}

export async function createActionFromXiaoyi(input: {
  projectId: string;
  requestId: string;
  payload: CreateActionInput;
}) {
  const startedAt = Date.now();
  const project = await requireProject(input.projectId);
  const confirmed = Boolean(input.payload.confirmed);
  const stage = confirmed ? "commit" : "proposal";
  const receiptId = externalRequestId("create_action", stage, input.requestId);
  const reservation = await reserveExternalAgentRun({
    projectId: project.id,
    runType: AgentRunType.ACTION,
    provider: XIAOYI_PROVIDER,
    externalRequestId: receiptId,
    trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "create_action", stage: "RECEIVED", requestId: input.requestId, confirmed },
  });

  if (!reservation.created) {
    const response = parseStoredResponse(createActionResponseSchema, reservation.run.resultJson);
    if (response) return { response: { ...response, replayed: true }, status: 200 };
    if (reservation.run.status === AgentRunStatus.FAILED) throwStoredFailure(reservation.run.resultJson);
    throw new AppError("XIAOYI_REQUEST_IN_PROGRESS", "相同 request_id 的调用仍在处理中", 409);
  }

  try {
    if (!confirmed) {
      const expiresAt = Date.now() + proposalTtlMs();
      const proposal = {
        v: 1 as const,
        projectId: project.id,
        title: input.payload.title as string,
        description: input.payload.description ?? null,
        priority: input.payload.priority ?? 3,
        dueAt: input.payload.due_at ?? null,
        sourceInterventionId: input.payload.source_intervention_id ?? null,
        sourceCardId: input.payload.source_card_id ?? null,
        expiresAt,
        nonce: randomUUID(),
      } satisfies ActionProposal;
      const proposalId = issueProposal(proposal);
      const response = {
        ok: true as const,
        request_id: input.requestId,
        agent_run_id: reservation.run.id,
        confirmed: false as const,
        replayed: false,
        proposal_id: proposalId,
        expires_at: new Date(expiresAt).toISOString(),
        proposed_action: {
          title: proposal.title,
          description: proposal.description,
          priority: proposal.priority,
          due_at: proposal.dueAt,
          source_intervention_id: proposal.sourceInterventionId,
          source_card_id: proposal.sourceCardId,
        },
      };
      await finishExternalAgentRun({
        runId: reservation.run.id,
        status: AgentRunStatus.SUCCESS,
        durationMs: Date.now() - startedAt,
        resultJson: response,
        trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "create_action", stage: "PROPOSAL_CREATED", requestId: input.requestId, confirmed: false, proposalHash: sign(proposalId) },
      });
      return { response, status: 200 };
    }

    const proposal = verifyProposal(input.payload.proposal_id as string, project.id);
    const result = await createOrReuseAction(project.id, {
      title: proposal.title,
      description: proposal.description,
      priority: proposal.priority,
      dueAt: proposal.dueAt,
      sourceInterventionId: proposal.sourceInterventionId,
      sourceCardId: proposal.sourceCardId,
      isSimulated: false,
    });
    const response = {
      ok: true as const,
      request_id: input.requestId,
      agent_run_id: reservation.run.id,
      confirmed: true as const,
      replayed: false,
      proposal_id: input.payload.proposal_id,
      reused: result.reused,
      action: {
        id: result.action.id,
        title: result.action.title,
        status: result.action.status,
        priority: result.action.priority,
        due_at: result.action.dueAt?.toISOString() ?? null,
      },
    };
    await finishExternalAgentRun({
      runId: reservation.run.id,
      status: AgentRunStatus.SUCCESS,
      durationMs: Date.now() - startedAt,
      resultJson: response,
      trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "create_action", stage: "COMMITTED", requestId: input.requestId, confirmed: true, proposalHash: sign(input.payload.proposal_id as string), actionId: result.action.id, reused: result.reused },
    });
    return { response, status: result.reused ? 200 : 201 };
  } catch (error) {
    const safe = safeXiaoyiError(error);
    try {
      await finishExternalAgentRun({
        runId: reservation.run.id,
        status: AgentRunStatus.FAILED,
        durationMs: Date.now() - startedAt,
        fallbackReason: safe.code,
        resultJson: { error: safe },
        trace: { source: "xiaoyi", provider: XIAOYI_PROVIDER, tool: "create_action", stage: "FAILED", requestId: input.requestId, confirmed, errorCode: safe.code },
      });
    } catch (auditError) {
      console.error("Failed to persist Xiaoyi create_action failure receipt", auditError);
    }
    throw error instanceof AppError ? error : new AppError(safe.code, safe.message, safe.status);
  }
}
