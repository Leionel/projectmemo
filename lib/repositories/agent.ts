import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type {
  ActionCreateInput,
  ActionUpdateInput,
  InterventionUpdateInput,
} from "@/lib/validation/schemas";
import type { AgentEvidence, ProposedAction } from "@/lib/types";
import {
  ActionStatus,
  AgentMessageRole,
  AgentRunStatus,
  AgentRunType,
  InterventionStatus,
  InterventionTrigger,
  Prisma,
} from "@/lib/generated/prisma/client";

const jsonValue = (value: unknown) => value as Prisma.InputJsonValue;

export async function listInterventions(projectId: string, includeClosed = true) {
  const now = new Date();
  return db.agentIntervention.findMany({
    where: {
      projectId,
      ...(includeClosed ? {} : {
        OR: [
          { status: InterventionStatus.OPEN },
          { status: InterventionStatus.SNOOZED, snoozedUntil: { lte: now } },
        ],
      }),
    },
    orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }],
    include: {
      evidenceCard: { select: { id: true, title: true, summary: true, type: true } },
      actions: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function findIntervention(projectId: string, interventionId: string) {
  const intervention = await db.agentIntervention.findFirst({
    where: { id: interventionId, projectId },
    include: { actions: true },
  });
  if (!intervention) throw new AppError("INTERVENTION_NOT_FOUND", "没有找到这条主动提醒", 404);
  return intervention;
}

export async function upsertIntervention(input: {
  projectId: string;
  triggerType: InterventionTrigger;
  dedupeKey: string;
  severity: number;
  title: string;
  content: string;
  evidence: AgentEvidence;
  proposedActions: ProposedAction[];
  evidenceCardId?: string | null;
  isSimulated?: boolean;
}) {
  const existing = await db.agentIntervention.findUnique({
    where: { projectId_dedupeKey: { projectId: input.projectId, dedupeKey: input.dedupeKey } },
  });
  const data = {
    triggerType: input.triggerType,
    severity: input.severity,
    title: input.title,
    content: input.content,
    evidence: jsonValue(input.evidence),
    proposedActions: jsonValue(input.proposedActions),
    evidenceCardId: input.evidenceCardId ?? null,
    isSimulated: Boolean(input.isSimulated),
  };
  if (!existing) {
    return db.agentIntervention.create({ data: { ...data, projectId: input.projectId, dedupeKey: input.dedupeKey } });
  }
  if (existing.status === InterventionStatus.DISMISSED || existing.status === InterventionStatus.RESOLVED) {
    if (input.severity <= existing.severity) return existing;
    return db.agentIntervention.update({
      where: { id: existing.id },
      data: { ...data, status: InterventionStatus.OPEN, handledAt: null, dismissReason: null, snoozedUntil: null },
    });
  }
  return db.agentIntervention.update({ where: { id: existing.id }, data });
}

export async function updateIntervention(projectId: string, interventionId: string, input: InterventionUpdateInput) {
  const existing = await findIntervention(projectId, interventionId);
  if (input.status === "ACCEPTED") {
    return acceptIntervention(projectId, interventionId, input.actionIndex ?? 0);
  }
  if ((existing.status === InterventionStatus.DISMISSED || existing.status === InterventionStatus.RESOLVED) && input.status !== existing.status) {
    throw new AppError("INVALID_INTERVENTION_TRANSITION", "已关闭的主动提醒不能重新打开", 409);
  }
  const status = input.status as InterventionStatus;
  const updated = await db.agentIntervention.update({
    where: { id: existing.id },
    data: {
      status,
      snoozedUntil: input.status === "SNOOZED" ? new Date(input.snoozedUntil as string) : null,
      dismissReason: input.status === "DISMISSED" ? input.dismissReason ?? null : null,
      handledAt: ["DISMISSED", "RESOLVED"].includes(input.status) ? new Date() : null,
    },
  });
  return { intervention: updated, action: null };
}

export async function acceptIntervention(projectId: string, interventionId: string, actionIndex = 0) {
  const intervention = await findIntervention(projectId, interventionId);
  if (intervention.status === InterventionStatus.DISMISSED || intervention.status === InterventionStatus.RESOLVED) {
    throw new AppError("INTERVENTION_CLOSED", "这条提醒已经关闭，不能再次接受", 409);
  }
  const existingAction = intervention.actions.find((action) => action.status !== ActionStatus.CANCELLED);
  if (existingAction) {
    return { intervention, action: existingAction };
  }
  const proposed = Array.isArray(intervention.proposedActions) ? (intervention.proposedActions as unknown as ProposedAction[]) : [];
  const selected = proposed[actionIndex] ?? proposed[0];
  if (!selected) {
    throw new AppError("NO_ACTION_PROPOSAL", "这条提醒没有可接受的行动建议", 400);
  }
  return db.$transaction(async (tx) => {
    const action = await tx.actionItem.create({
      data: {
        projectId,
        sourceInterventionId: interventionId,
        sourceCardId: intervention.evidenceCardId,
        title: selected.title,
        description: selected.description ?? (selected.kind === "generate_artifact" ? "确认后生成对应成果，完成时记录版本和修改结果。" : null),
        priority: selected.priority ?? intervention.severity,
        dueAt: selected.dueAt ? new Date(selected.dueAt) : null,
        isSimulated: intervention.isSimulated,
      },
    });
    const updated = await tx.agentIntervention.update({
      where: { id: interventionId },
      data: { status: InterventionStatus.ACCEPTED },
    });
    return { intervention: updated, action };
  });
}

export async function listActions(projectId: string, includeClosed = true) {
  return db.actionItem.findMany({
    where: { projectId, ...(includeClosed ? {} : { status: { notIn: [ActionStatus.DONE, ActionStatus.CANCELLED] } }) },
    orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
    include: {
      sourceIntervention: { select: { id: true, title: true, triggerType: true } },
      sourceCard: { select: { id: true, title: true } },
      resultCard: { select: { id: true, title: true } },
    },
  });
}

async function assertActionSources(projectId: string, input: { sourceInterventionId?: string | null; sourceCardId?: string | null }) {
  if (input.sourceInterventionId) {
    const found = await db.agentIntervention.findFirst({ where: { id: input.sourceInterventionId, projectId } });
    if (!found) throw new AppError("INTERVENTION_NOT_FOUND", "行动引用的提醒不属于当前项目", 404);
  }
  if (input.sourceCardId) {
    const found = await db.knowledgeCard.findFirst({ where: { id: input.sourceCardId, projectId } });
    if (!found) throw new AppError("CARD_NOT_FOUND", "行动引用的知识卡片不属于当前项目", 404);
  }
}

export async function createAction(projectId: string, input: ActionCreateInput) {
  await assertActionSources(projectId, input);
  return db.actionItem.create({
    data: {
      projectId,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? 3,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      sourceInterventionId: input.sourceInterventionId ?? null,
      sourceCardId: input.sourceCardId ?? null,
      isSimulated: input.isSimulated ?? false,
    },
  });
}

export async function createOrReuseAction(projectId: string, input: ActionCreateInput) {
  await assertActionSources(projectId, input);
  if (input.sourceCardId) {
    const existing = await db.actionItem.findFirst({
      where: {
        projectId,
        sourceCardId: input.sourceCardId,
        title: input.title,
        status: { in: [ActionStatus.TODO, ActionStatus.DOING] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return { action: existing, reused: true };
  }
  return { action: await createAction(projectId, input), reused: false };
}

export async function findAction(projectId: string, actionId: string) {
  const action = await db.actionItem.findFirst({ where: { id: actionId, projectId }, include: { sourceIntervention: true } });
  if (!action) throw new AppError("ACTION_NOT_FOUND", "没有找到这条行动项", 404);
  return action;
}

export async function updateAction(projectId: string, actionId: string, input: ActionUpdateInput) {
  const existing = await findAction(projectId, actionId);
  if (input.status && input.status !== existing.status) {
    const allowed: Record<string, string[]> = {
      TODO: ["DOING", "CANCELLED"],
      DOING: ["TODO", "CANCELLED"],
      DONE: [],
      CANCELLED: [],
    };
    if (!allowed[String(existing.status)]?.includes(input.status)) {
      throw new AppError("INVALID_ACTION_TRANSITION", "行动状态不能从当前状态直接跳转", 409);
    }
  }
  return db.actionItem.update({
    where: { id: actionId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(input.status !== undefined ? { status: input.status as ActionStatus } : {}),
      ...(input.resultText !== undefined ? { resultText: input.resultText } : {}),
      ...(input.status === "DONE" ? { completedAt: new Date() } : {}),
    },
  });
}

export async function deleteSimulatedAgentData(projectId: string) {
  await db.$transaction([
    db.actionItem.deleteMany({ where: { projectId, isSimulated: true } }),
    db.agentIntervention.deleteMany({ where: { projectId, isSimulated: true } }),
  ]);
}

export async function saveAgentRun(input: {
  projectId: string;
  runType: AgentRunType;
  status: AgentRunStatus;
  provider: string;
  trace: Record<string, unknown>;
  externalRequestId?: string | null;
  resultJson?: Record<string, unknown> | null;
  fallbackReason?: string | null;
  durationMs?: number;
}) {
  return db.agentRun.create({
    data: {
      projectId: input.projectId,
      runType: input.runType,
      status: input.status,
      provider: input.provider,
      externalRequestId: input.externalRequestId ?? null,
      trace: jsonValue(input.trace),
      resultJson: input.resultJson ? jsonValue(input.resultJson) : undefined,
      fallbackReason: input.fallbackReason ?? null,
      durationMs: input.durationMs ?? null,
    },
  });
}

function isUniqueConstraintError(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export async function reserveExternalAgentRun(input: {
  projectId: string;
  runType: AgentRunType;
  provider: string;
  externalRequestId: string;
  trace: Record<string, unknown>;
}) {
  try {
    const run = await saveAgentRun({
      ...input,
      status: AgentRunStatus.PARTIAL,
    });
    return { run, created: true };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const run = await db.agentRun.findUnique({
      where: {
        provider_externalRequestId: {
          provider: input.provider,
          externalRequestId: input.externalRequestId,
        },
      },
    });
    if (!run) throw error;
    return { run, created: false };
  }
}

export async function finishExternalAgentRun(input: {
  runId: string;
  status: AgentRunStatus;
  trace: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  durationMs: number;
  fallbackReason?: string | null;
}) {
  return db.agentRun.update({
    where: { id: input.runId },
    data: {
      status: input.status,
      trace: jsonValue(input.trace),
      resultJson: jsonValue(input.resultJson),
      durationMs: input.durationMs,
      fallbackReason: input.fallbackReason ?? null,
    },
  });
}

export async function listAgentRuns(projectId: string, limit = 20) {
  return db.agentRun.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: limit });
}

export async function saveAgentMessage(input: {
  projectId: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations: unknown[];
  proposedActions: unknown[];
  runId?: string | null;
}) {
  return db.agentMessage.create({
    data: {
      projectId: input.projectId,
      role: input.role === "USER" ? AgentMessageRole.USER : AgentMessageRole.ASSISTANT,
      content: input.content,
      citations: jsonValue(input.citations),
      proposedActions: jsonValue(input.proposedActions),
      runId: input.runId ?? null,
    },
  });
}

export async function listAgentMessages(projectId: string, limit = 20) {
  return db.agentMessage.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: limit });
}

export async function getProjectMetrics(projectId: string) {
  const [cards, relations, interventions, actions, artifacts, simulatedInterventionCount, simulatedActionCount] = await Promise.all([
    db.knowledgeCard.findMany({ where: { projectId }, select: { id: true } }),
    db.cardRelation.count({ where: { currentCard: { projectId } } }),
    db.agentIntervention.findMany({ where: { projectId, isSimulated: false }, select: { status: true } }),
    db.actionItem.findMany({ where: { projectId, isSimulated: false }, select: { status: true, resultCardId: true } }),
    db.generatedArtifact.findMany({ where: { projectId }, select: { artifactType: true } }),
    db.agentIntervention.count({ where: { projectId, isSimulated: true } }),
    db.actionItem.count({ where: { projectId, isSimulated: true } }),
  ]);
  const cardCount = cards.length;
  const interventionCount = interventions.length;
  const acceptedInterventionCount = interventions.filter((item) => item.status === InterventionStatus.ACCEPTED || item.status === InterventionStatus.RESOLVED).length;
  const actionCount = actions.length;
  const completedActionCount = actions.filter((item) => item.status === ActionStatus.DONE).length;
  const closedLoopCount = actions.filter((item) => item.status === ActionStatus.DONE && item.resultCardId).length;
  const relationRate = cardCount ? Math.min(1, relations / cardCount) : 0;
  const traceabilityRate = cardCount ? actions.filter((item) => item.resultCardId).length / Math.max(1, actionCount) : 0;
  return {
    cardCount,
    relationCount: relations,
    associationRate: Math.round(relationRate * 100),
    traceabilityRate: Math.round(traceabilityRate * 100),
    interventionCount,
    acceptedInterventionCount,
    acceptanceRate: interventionCount ? Math.round((acceptedInterventionCount / interventionCount) * 100) : 0,
    actionCount,
    completedActionCount,
    actionCompletionRate: actionCount ? Math.round((completedActionCount / actionCount) * 100) : 0,
    closedLoopCount,
    artifactCount: artifacts.length,
    artifactCoverageRate: cardCount && artifacts.length ? Math.min(100, Math.round((artifacts.length / 6) * 100)) : 0,
    simulatedExcluded: simulatedInterventionCount + simulatedActionCount,
  };
}
