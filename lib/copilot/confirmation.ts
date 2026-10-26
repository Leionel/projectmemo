import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/api";
import { db } from "@/lib/db";
import type { Prisma } from "@/lib/generated/prisma/client";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { createActionInTx } from "@/lib/repositories/agent";
import { prepareArtifactGeneration, savePreparedArtifactInTx } from "@/lib/services/artifactService";
import { refreshProjectStateAfterMutation } from "@/lib/services/projectStateService";
import { actionCreateSchema, artifactCreateSchema } from "@/lib/validation/schemas";
import type { AgentToolConfirmInput } from "@/lib/validation/schemas";
import type { ProposedAction } from "@/lib/types";

type Tx = Prisma.TransactionClient;
export type CopilotActor = { userId: string; sessionId: string };
export const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  contextHash: z.string().regex(/^[a-f0-9]{64}$/),
  cardHashes: z.array(z.object({ id: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()),
  observedAt: z.string().datetime(),
}).strict();
export type SourceManifest = z.infer<typeof manifestSchema>;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export async function assertActor(tx: Tx, projectId: string, actor?: CopilotActor) {
  if (!actor) return; // Trusted in-process callers; HTTP routes always supply authenticated context.
  const session = await tx.authSession.findFirst({ where: {
    id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() },
  } });
  if (!session) throw new AppError("UNAUTHORIZED", "登录状态已失效，请重新登录", 401);
  const membership = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId } } });
  if (!membership) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
}

/** Same fields supplied by Copilot, plus full source fingerprints for its future artifact context. */
export async function readCopilotContext(tx: Tx, projectId: string, actor?: CopilotActor, ownRunId?: string) {
  await assertActor(tx, projectId, actor);
  const project = await tx.project.findUnique({ where: { id: projectId } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const now = new Date();
  const [cards, interventions, allActions] = await Promise.all([
    tx.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "desc" },
      select: { id: true, title: true, summary: true, type: true, keywords: true } }),
    tx.agentIntervention.findMany({ where: { projectId, NOT:{dedupeKey:{startsWith:"goal:"}}, OR: [
      { status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } },
    ] }, orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "desc" }] }),
    tx.actionItem.findMany({ where: { projectId, status: { notIn: ["DONE", "CANCELLED"] } },
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }] }),
  ]);
  // Independent frozen proposals from the same answer may be consumed separately. Only
  // successful actions with this unforgeable server dedupe prefix are excluded from its base.
  const actions = ownRunId ? allActions.filter(action => !action.dedupeKey?.startsWith(`copilot:${ownRunId}:`)) : allActions;
  const cardHashes = [];
  for (const card of [...cards].sort((a, b) => a.id.localeCompare(b.id))) {
    const hash = await sourceHash(projectId, `card:${card.id}`, tx);
    if (!hash) throw new AppError("SOURCE_CHANGED", "项目记忆刚发生变化，请重新提问", 409);
    cardHashes.push({ id: card.id, hash });
  }
  const sourceManifest: SourceManifest = {
    schemaVersion: 1,
    contextHash: jsonHash({
      project: { id: project.id, title: project.title, description: project.description, goal: project.goal,
        deadline: project.deadline, scenario: project.scenario, archivedAt: project.archivedAt },
      cards: [...cards].sort((a, b) => a.id.localeCompare(b.id)),
      interventions: interventions.map(item => ({ id: item.id, title: item.title, content: item.content,
        status: item.status, evidenceCardId: item.evidenceCardId, isSimulated: item.isSimulated,
        severity: item.severity, snoozedUntil: item.snoozedUntil })).sort((a, b) => a.id.localeCompare(b.id)),
      actions: actions.map(item => ({ id: item.id, title: item.title, status: item.status, priority: item.priority,
        dueAt: item.dueAt, description: item.description, sourceCardId: item.sourceCardId,
        sourceInterventionId: item.sourceInterventionId, dependencyVersion: item.dependencyVersion,
        isSimulated: item.isSimulated })).sort((a, b) => a.id.localeCompare(b.id)),
    }),
    cardHashes,
    observedAt: now.toISOString(),
  };
  return { project, cards, interventions, actions, sourceManifest };
}

export async function assertCopilotSources(tx: Tx, projectId: string, manifest: SourceManifest, actor?: CopilotActor, ownRunId?: string) {
  const current = (await readCopilotContext(tx, projectId, actor, ownRunId)).sourceManifest;
  if (current.contextHash !== manifest.contextHash || jsonHash(current.cardHashes) !== jsonHash(manifest.cardHashes)) {
    throw new AppError("SOURCE_CHANGED", "项目目标或依据已变化，请重新提问并确认新建议", 409);
  }
}

function proposalPayload(proposal: Record<string, unknown>, tool: string) {
  if (tool === "create_action") return actionCreateSchema.parse({ title: proposal.title,
    description: proposal.description ?? "", priority: proposal.priority ?? 3, dueAt: proposal.dueAt ?? undefined });
  return { artifactType: artifactCreateSchema.parse({ artifactType: proposal.artifactType }).artifactType };
}
const keyOf = (tool: string, proposal: Record<string, unknown>) => tool === "create_action" ? `action:${proposal.title}` : `artifact:${proposal.artifactType}`;

/** Must run in the same transaction that creates its source AgentRun. */
export async function freezeCopilotProposals(tx: Tx, sourceRunId: string, proposals: ProposedAction[], manifest: SourceManifest) {
  const seen = new Map<string, string>();
  for (const proposed of proposals) {
    const proposal = proposed as unknown as Record<string, unknown>;
    const key = keyOf(proposed.kind, proposal), payload = proposalPayload(proposal, proposed.kind);
    const proposalHash = jsonHash({ tool: proposed.kind, payload });
    if (seen.has(key)) {
      if (seen.get(key) !== proposalHash) throw new AppError("COPILOT_PROPOSAL_AMBIGUOUS", "同一建议包含冲突内容，请重新提问", 409);
      continue;
    }
    seen.set(key, proposalHash);
    await tx.copilotToolExecution.create({ data: { sourceRunId, proposalKey: key, tool: proposed.kind,
      proposalJson: json(payload), proposalHash, sourceManifestHash: jsonHash(manifest) } });
  }
}

export async function writeTransaction<T>(sourceRunId: string, callback: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        // Acquire SQLite's write slot before reading the proposal/receipt. An in-memory
        // mutex cannot provide this ordering between application processes.
        await tx.$executeRaw`UPDATE "AgentRun" SET "id" = "id" WHERE "id" = ${sourceRunId}`;
        return callback(tx);
      }, { maxWait: 5000, timeout: 15000 });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (attempt >= 3 || !(code === "P1008" || code === "P2034" || /SQLITE_BUSY|database is locked/i.test(String(error)))) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

async function inspectConfirmation(tx: Tx, projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  await assertActor(tx, projectId, actor);
  const run = await tx.agentRun.findFirst({ where: { id: input.sourceRunId, runType: "CHAT", OR: [
    { projectId }, ...(actor ? [{ projectId: null, conversation: { ownerUserId: actor.userId } }] : []),
  ] } });
  if (!run) throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有找到这次回答的证据回执", 404);
  const trace = object(run.trace), result = object(run.resultJson);
  if (run.projectId === null && trace.copilotTargetProjectId !== projectId)
    throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有本项目的提案回执", 404);
  if (trace.actorUserId && actor && trace.actorUserId !== actor.userId) throw new AppError("TRUST_RECEIPT_NOT_FOUND", "没有可确认的建议", 404);
  if (trace.supportState !== "SUPPORTED") throw new AppError("EVIDENCE_NOT_SUPPORTED", "证据存在冲突或不足，已阻止写操作", 409);
  const allowed = Array.isArray(result.proposedActions) ? result.proposedActions.map(object) : [];
  const proposed = allowed.find(proposal => proposal.kind === input.tool && (input.tool === "create_action"
    ? proposal.title === input.payload.title : proposal.artifactType === input.payload.artifactType));
  if (!proposed) throw new AppError("UNAPPROVED_TOOL_PROPOSAL", "这个操作不属于该证据回执中的建议", 409);
  const key = keyOf(input.tool, proposed), confirmationHash = jsonHash({ tool: input.tool, payload: input.payload });
  const execution = await tx.copilotToolExecution.findUnique({ where: { sourceRunId_proposalKey: { sourceRunId: run.id, proposalKey: key } } });
  if (execution?.status === "DECLINED") throw new AppError("PROPOSAL_DECLINED", "这项提案已被拒绝，请重新讨论", 409);
  if (execution?.confirmationHash && execution.confirmationHash !== confirmationHash) {
    throw new AppError("CONFIRMATION_PAYLOAD_CHANGED", "该建议已使用不同内容确认，请勿更改重试载荷", 409);
  }
  const legacyReceipt = object(object(result.executedProposals)[key]);
  const resultId = execution?.status === "COMMITTED" ? execution.resultId : !execution ? legacyReceipt.resultId : null;
  if (typeof resultId === "string") {
    const old = input.tool === "create_action" ? await tx.actionItem.findFirst({ where: { id: resultId, projectId } })
      : await tx.generatedArtifact.findFirst({ where: { id: resultId, projectId } });
    if (!old) throw new AppError("COPILOT_RESULT_MISSING", "原确认结果已不可用，不能重复创建，请查看项目历史", 409);
    return { replay: { tool: input.tool, result: old, alreadyExecuted: true as const }, run, result, key, confirmationHash, execution, manifest: null };
  }
  const parsed = manifestSchema.safeParse(trace.copilotSources);
  if (!execution || !parsed.success) throw new AppError("COPILOT_PROPOSAL_REGENERATE_REQUIRED", "这条旧建议缺少可校验的来源版本，请重新提问后确认", 409);
  if (execution.tool !== input.tool || execution.proposalHash !== jsonHash({ tool: input.tool, payload: proposalPayload(proposed, input.tool) }) ||
    execution.proposalHash !== jsonHash({ tool: execution.tool, payload: execution.proposalJson }) || execution.sourceManifestHash !== jsonHash(parsed.data)) {
    throw new AppError("COPILOT_PROPOSAL_CHANGED", "建议或来源回执不一致，请重新提问", 409);
  }
  await assertCopilotSources(tx, projectId, parsed.data, actor, run.id);
  return { replay: null, run, result, key, confirmationHash, execution, manifest: parsed.data };
}

async function recordConsumption(tx: Tx, state: Awaited<ReturnType<typeof inspectConfirmation>>, tool: string, resultId: string) {
  if (!state.execution) throw new Error("Missing durable Copilot intent");
  await tx.copilotToolExecution.update({ where: { id: state.execution.id }, data: {
    status: "COMMITTED", confirmationHash: state.confirmationHash, resultId, committedAt: new Date(), leaseToken: null, leaseUntil: null,
  } });
  // Maintain the legacy read contract, now inside the same transaction as the effect.
  await tx.agentRun.update({ where: { id: state.run.id }, data: { resultJson: json({ ...state.result,
    executedProposals: { ...object(state.result.executedProposals), [state.key]: { tool, resultId, executedAt: new Date().toISOString() } },
  }) } });
}

export async function confirmCopilotTool(projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  if (!input.confirmed) throw new AppError("CONFIRMATION_REQUIRED", "写操作需要你确认后才能执行", 400);
  if (!input.sourceRunId) throw new AppError("TRUST_RECEIPT_REQUIRED", "缺少证据回执，请重新提问后确认", 409);
  const sourceRunId = input.sourceRunId;
  if (input.tool === "create_action") {
    const outcome = await writeTransaction(sourceRunId, tx => confirmCopilotActionInTx(tx, projectId, input, actor));
    const stateRefreshPending = await refreshProjectStateAfterMutation(projectId);
    return { ...outcome, result: { ...outcome.result, stateRefreshPending } };
  }
  const leaseToken = randomUUID();
  const reserved = await writeTransaction(sourceRunId, async tx => {
    const state = await inspectConfirmation(tx, projectId, input, actor);
    if (state.replay) return { replay: state.replay, artifactType: null };
    if (state.execution!.status === "PREPARING" && state.execution!.leaseUntil && state.execution!.leaseUntil > new Date()) {
      throw new AppError("COPILOT_CONFIRMATION_IN_PROGRESS", "这条建议正在生成，请稍后重试查看同一结果", 409);
    }
    const artifactType = artifactCreateSchema.parse(state.execution!.proposalJson).artifactType;
    await tx.copilotToolExecution.update({ where: { id: state.execution!.id }, data: {
      status: "PREPARING", confirmationHash: state.confirmationHash, leaseToken, leaseUntil: new Date(Date.now() + 120000),
    } });
    return { replay: null, artifactType };
  });
  if (reserved.replay) return reserved.replay;
  try {
    const prepared = await prepareArtifactGeneration(projectId, reserved.artifactType!);
    return await writeTransaction(sourceRunId, async tx => {
      const state = await inspectConfirmation(tx, projectId, input, actor);
      if (state.replay) return state.replay;
      if (state.execution!.leaseToken !== leaseToken || state.execution!.status !== "PREPARING" || !state.execution!.leaseUntil || state.execution!.leaseUntil <= new Date()) {
        throw new AppError("COPILOT_CONFIRMATION_CHANGED", "生成许可已过期或被接续，请刷新后重试", 409);
      }
      const artifact = await savePreparedArtifactInTx(tx, prepared);
      await recordConsumption(tx, state, input.tool, artifact.id);
      return { tool: input.tool, result: artifact, alreadyExecuted: false };
    });
  } catch (error) {
    await db.copilotToolExecution.updateMany({ where: { sourceRunId, status: "PREPARING", leaseToken },
      data: { status: "PENDING", leaseToken: null, leaseUntil: null } }).catch(() => {});
    throw error;
  }
}

/** Shared atomic action path for project Copilot and the private conversation. */
export async function confirmCopilotActionInTx(tx: Tx, projectId: string, input: AgentToolConfirmInput, actor?: CopilotActor) {
  if (input.tool !== "create_action" || !input.confirmed || !input.sourceRunId)
    throw new AppError("CONFIRMATION_REQUIRED", "创建行动需要明确确认", 400);
  const state = await inspectConfirmation(tx, projectId, input, actor);
  if (state.replay) return state.replay;
  const payload = actionCreateSchema.parse(state.execution!.proposalJson);
  const action = await createActionInTx(tx, projectId, payload, `copilot:${input.sourceRunId}:${state.execution!.id}`);
  await recordConsumption(tx, state, input.tool, action.id);
  return { tool: input.tool, result: action, alreadyExecuted: false };
}
