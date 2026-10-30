import { db } from "@/lib/db";
import { record } from "@/lib/conversation/repository";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash, usageOf, terminal } from "./contracts";
import { commandReplay, event, lock, ownedMission, type Tx } from "./repository";
import { missionWorkState } from "./workState";
import { readWorkerPresence } from "./workerPresence";
import { AppError } from "@/lib/api";
import { z } from "zod";
import {
  constraintsSchema,
  continuationPolicySchema,
  researchScopeSchema,
} from "@/lib/types/mission";
import { initializeDelegation } from "./investigationDelegation";

export async function resolveSourceGrantVersions(tx: Tx, userId: string, projectId: string, connectionIds: string[]) {
  const membership = await tx.projectMembership.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { role: true },
  });
  if (!Array.isArray(connectionIds) || !connectionIds.length) {
    return { membershipRole: membership?.role ?? null, connections: [] };
  }
  const conns = await tx.sourceConnection.findMany({
    where: { id: { in: connectionIds }, projectId, ownerUserId: userId },
    orderBy: { id: "asc" },
    select: { id: true, revision: true, status: true, revokedAt: true, signalKind: true },
  });
  return {
    membershipRole: membership?.role ?? null,
    connections: conns.map(c => ({
      id: c.id,
      revision: c.revision,
      status: c.status,
      revokedAt: c.revokedAt ? c.revokedAt.toISOString() : null,
      signalKind: c.signalKind,
    })),
  };
}

/** One snapshot of the original responsibility. This read grants no execution permission. */
export async function readMissionResponsibility(userId: string, id: string, externalTx?: Tx) {
  const run = async (tx: Tx) => {
    const m = await ownedMission(userId, id, tx);
    const [continuity, events, approvals] = await Promise.all([
      effectiveContinuity(userId, { projectId: m.projectId, missionId: id }, tx),
      tx.agentMissionEvent.findMany({ where: { missionId: id }, orderBy: [{ seq: "desc" }, { id: "desc" }], take: 21 }),
      tx.agentMissionApproval.findMany({ where: { missionId: id, status: "PENDING" }, orderBy: { id: "asc" }, take: 10 }),
    ]);
    const policy = record(m.continuationPolicyJson), constraints = record(m.constraintsJson);
    const state = missionWorkState({ ...m, events, approvals, delegationEnabled: isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false) });
    const expired = policy.mode === "BOUNDED_INVESTIGATION" && !(Date.parse(String(policy.expiresAt)) > Date.now());
    const active = !continuity.stopped && !expired && !["SUCCEEDED", "CANCELLED", "PAUSED", "FAILED"].includes(m.status) && !m.pauseRequestedAt && !m.cancelRequestedAt;

    const connectionIds = Array.isArray(policy.connectionIds) ? (policy.connectionIds as string[]) : [];
    const sourceGrants = await resolveSourceGrantVersions(tx, userId, m.projectId, connectionIds);

    const controlVersion = jsonHash({
      missionId: id,
      version: m.version,
      contextVersion: m.contextVersion,
      planRevision: m.planRevision,
      constraintsVersion: m.constraintsVersion,
      researchScopeVersion: m.researchScopeVersion,
      continuationPolicy: m.continuationPolicyJson,
      intentHash: continuity.intentHash,
      reusePolicyHash: continuity.reusePolicyHash,
      sourceGrants,
      stopped: continuity.stopped,
      expired,
    });

    const presence = readWorkerPresence();

    const pendingOriginalRefs = {
      questionId: state.exactQuestionRef ?? null,
      approvalIds: approvals.map(a => a.id),
    };

    return {
      schemaVersion: 1 as const,
      missionId: id,
      projectId: m.projectId,
      controlVersion,
      goal: m.goal,
      successCriteria: m.successCriteriaJson,
      workingObjective: continuity.workingObjective,
      constraints: m.constraintsJson,
      researchScope: m.researchScopeJson,
      continuationPolicy: m.continuationPolicyJson,
      deadline: typeof constraints.deadline === "string" ? constraints.deadline : null,
      permissionExpiresAt: typeof policy.expiresAt === "string" ? policy.expiresAt : null,
      permissionState: continuity.stopped ? "STOPPED" : expired ? "EXPIRED" : "WITHIN_TIME_BOUNDARY",
      budget: {
        limits: m.budgetJson,
        cumulativeUsed: usageOf(m.budgetUsedJson),
        additionalUsed: m.budgetUsedJson,
        policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE" as const,
        monetaryCost: null,
      },
      workState: state,
      pendingOriginalRefs,
      // A schedule is not worker liveness or a promise of successful observation.
      nextCheckAt: active && policy.mode === "BOUNDED_INVESTIGATION" && state.phase === "WAITING_OBSERVATION" ? state.nextCheckAt : null,
      workerPresence: presence.status,
      workerPresenceDetail: presence.status !== "UNOBSERVED" ? {
        workerId: presence.workerId,
        lastHeartbeatAt: presence.lastHeartbeatAt,
        lastScanAt: presence.lastScanAt,
        lastClaimAt: presence.lastClaimAt,
      } : null,
      activity: events.slice(0, 20).map(e => ({ id: e.id, sequence: e.seq, kind: e.type, at: e.createdAt.toISOString() })),
      coverage: { activityHasMore: events.length > 20 },
      authority: "ORIGINAL_MISSION_READ_ONLY_PROJECTION" as const,
    };
  };

  return externalTx ? run(externalTx) : db.$transaction(run);
}

export const reviseResponsibilitySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedControlVersion: z.string().min(1).max(128),
  goal: z.string().trim().min(1).max(300).optional(),
  successCriteria: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
  workingObjective: z.string().trim().max(300).optional(),
  constraints: constraintsSchema.optional(),
  researchScope: researchScopeSchema.optional(),
  continuationPolicy: continuationPolicySchema.optional(),
  llmContextApproved: z.boolean().optional(),
}).strict();

export type ReviseResponsibilityInput = z.infer<typeof reviseResponsibilitySchema>;

export async function reviseMissionResponsibility(userId: string, id: string, raw: unknown) {
  const body = reviseResponsibilitySchema.parse(raw);
  const hash = jsonHash(body);

  return db.$transaction(async tx => {
    await lock(tx, id);
    const m = await ownedMission(userId, id, tx);

    if (await commandReplay(tx, id, body.requestId, hash)) {
      return readMissionResponsibility(userId, id, tx);
    }

    if (terminal.includes(m.status)) {
      throw new AppError("MISSION_CHANGED", "委托已结束，无法修订责任合同", 409);
    }

    const currentSnapshot = await readMissionResponsibility(userId, id, tx);
    if (currentSnapshot.controlVersion !== body.expectedControlVersion) {
      throw new AppError("MISSION_CHANGED", "责任合同已变化或来源权限已更新，请刷新后核对", 409);
    }

    const oldConstraints = record(m.constraintsJson) as Record<string, unknown>;
    const effectiveLlmContextApproved = body.llmContextApproved !== undefined
      ? body.llmContextApproved
      : (body.constraints?.executionBoundary !== undefined || body.constraints?.costCeiling !== undefined
        ? (body.constraints as unknown as Record<string, unknown>).llmContextApproved ?? oldConstraints.llmContextApproved
        : oldConstraints.llmContextApproved);

    const mergedConstraints = body.constraints
      ? { ...body.constraints, llmContextApproved: effectiveLlmContextApproved }
      : body.llmContextApproved !== undefined
      ? { ...oldConstraints, llmContextApproved: body.llmContextApproved }
      : oldConstraints;

    const mergedScope = body.researchScope ?? record(m.researchScopeJson);
    const mergedPolicy = body.continuationPolicy ?? record(m.continuationPolicyJson);

    // Cross-field validations
    if (typeof mergedConstraints.deadline === "string" && mergedConstraints.deadline.length > 0) {
      const parsedDeadline = Date.parse(mergedConstraints.deadline);
      if (isNaN(parsedDeadline)) {
        throw new AppError("INVALID_DEADLINE", "截止日期格式无效", 422);
      }
    }

    let delegation = null;
    if (mergedPolicy.mode === "BOUNDED_INVESTIGATION") {
      const syntheticMission = {
        ...m,
        constraintsJson: json(mergedConstraints),
        researchScopeJson: json(mergedScope),
      };
      delegation = await initializeDelegation(tx, syntheticMission, mergedPolicy);
    }

    // Invalidate existing pending approvals and ready steps so no half-expanded authority remains
    await tx.agentMissionApproval.updateMany({
      where: { missionId: id, status: { in: ["PENDING", "APPROVED"] } },
      data: { status: "EXPIRED" },
    });
    await tx.agentMissionStep.updateMany({
      where: { missionId: id, status: { in: ["READY", "WAITING_APPROVAL"] } },
      data: { status: "OBSOLETE" },
    });

    const constraintsChanged = body.constraints !== undefined || body.llmContextApproved !== undefined;
    const scopeChanged = body.researchScope !== undefined;
    const policyChanged = body.continuationPolicy !== undefined;
    const goalChanged = body.goal !== undefined && body.goal !== m.goal;
    const successCriteriaChanged = body.successCriteria !== undefined;

    const newStatus = m.status === "WAITING_APPROVAL"
      ? "READY"
      : (delegation && m.status === "WAITING_INPUT" ? "READY" : m.status);

    await tx.agentMission.update({
      where: { id },
      data: {
        ...(goalChanged ? { goal: body.goal! } : {}),
        ...(successCriteriaChanged ? { successCriteriaJson: json(body.successCriteria!) } : {}),
        ...(constraintsChanged ? { constraintsJson: json(mergedConstraints), constraintsVersion: { increment: 1 } } : {}),
        ...(scopeChanged ? { researchScopeJson: json(mergedScope), researchScopeVersion: { increment: 1 } } : {}),
        ...(policyChanged ? { continuationPolicyJson: json(mergedPolicy) } : {}),
        contextVersion: { increment: 1 },
        planRevision: { increment: 1 },
        version: { increment: 1 },
        status: newStatus,
        nextAttemptAt: null,
        planJson: json({
          ...record(m.planJson),
          automaticContinuation: null,
          delegation,
          resumeStatus: newStatus === "PAUSED" ? "READY" : (m.planJson as { resumeStatus?: string }).resumeStatus,
        }),
      },
    });

    const diff = {
      goal: goalChanged ? { from: m.goal, to: body.goal } : undefined,
      successCriteria: successCriteriaChanged ? { to: body.successCriteria } : undefined,
      constraints: constraintsChanged ? { to: mergedConstraints } : undefined,
      researchScope: scopeChanged ? { to: mergedScope } : undefined,
      continuationPolicy: policyChanged ? { to: mergedPolicy } : undefined,
      workingObjective: body.workingObjective,
    };

    await event(tx, id, "RESPONSIBILITY_REVISED", {
      diff,
      previousControlVersion: body.expectedControlVersion,
    }, { id: `cmd:${body.requestId}`, hash });

    return readMissionResponsibility(userId, id, tx);
  });
}
