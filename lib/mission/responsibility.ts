import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { record } from "@/lib/conversation/repository";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash, usageOf, terminal, successCriterionSchema, defaultBudget } from "./contracts";
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
import { invalidateContinuityConsumers } from "@/lib/continuity/invalidation";

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
    select: { id: true, repo: true, ref: true, status: true, revokedAt: true, signalKind: true },
  });
  return {
    membershipRole: membership?.role ?? null,
    connections: conns.map(c => ({
      id: c.id,
      repo: c.repo,
      ref: c.ref,
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
      goal: m.goal,
      successCriteria: m.successCriteriaJson,
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

    const baseLimits = { ...defaultBudget, metadataRequests:24, ...(m.budgetJson as Record<string, unknown>) } as Record<string, unknown>;
    const limits = policy.mode === "BOUNDED_INVESTIGATION" ? {
      ...baseLimits,
      models: Math.min(Number(policy.maxModels), Number(baseLimits.models)),
      tools: Math.min(Number(policy.maxTools), Number(baseLimits.tools)),
      metadataRequests: Math.min(Number(policy.maxMetadataRequests), Number(baseLimits.metadataRequests ?? 24)),
      dailyBurst: policy.dailyBurst,
    } : baseLimits;

    return {
      schemaVersion: 1 as const,
      missionId: id,
      projectId: m.projectId,
      controlVersion,
      goal: m.goal,
      successCriteria: m.successCriteriaJson,
      successCriteriaLabels: (Array.isArray(m.successCriteriaJson)?m.successCriteriaJson:[]).map(c=>{
        const labels:Record<string,string>={DRAFT_EXISTS:"草稿已保存",ACTION_CREATED:"已创建行动",APPROVAL_CONSUMED:"已执行获批提案",REQUIRED_INPUT_PRESENT:"必要资料已补齐",FIXED_METRIC_JOB_RECORDED:"固定核算回执已记录",PAPER_METADATA_READ:"已核对论文元数据",ACTION_RESULT_RECORDED:"行动完成回执已记录"};
        return typeof c==="string"?labels[c]??"需核对的验收条件":record(c).type==="SOURCE_COUNT"?`至少核对 ${record(c).minimum} 个来源`:"需核对的验收条件";
      }),
      workingObjective: continuity.workingObjective,
      constraints: m.constraintsJson,
      researchScope: m.researchScopeJson,
      continuationPolicy: m.continuationPolicyJson,
      llmContextApproved: Boolean(constraints.llmContextApproved),
      deadline: typeof constraints.deadline === "string" ? constraints.deadline : null,
      permissionExpiresAt: typeof policy.expiresAt === "string" ? policy.expiresAt : null,
      permissionState: continuity.stopped ? "STOPPED" : expired ? "EXPIRED" : "WITHIN_TIME_BOUNDARY",
      budget: {
        limits,
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
        isProcessAlive: presence.isProcessAlive,
        isActivelyInspecting: presence.isActivelyInspecting,
        hasClaimedWork: presence.hasClaimedWork,
      } : null,
      activity: events.slice(0, 20).map(e => ({ id: e.id, sequence: e.seq, kind: e.type, at: e.createdAt.toISOString() })),
      coverage: { activityHasMore: events.length > 20 },
      authority: "ORIGINAL_MISSION_READ_ONLY_PROJECTION" as const,
    };
  };

  return externalTx ? run(externalTx) : db.$transaction(run);
}

export const reviseConstraintsSchema = constraintsSchema.extend({
  llmContextApproved: z.boolean().optional(),
});

export const reviseResponsibilitySchema = z.object({
  requestId: z.string().min(1).max(128),
  expectedControlVersion: z.string().min(1).max(128),
  goal: z.string().trim().min(1).max(300).optional(),
  successCriteria: z.array(successCriterionSchema).min(1).max(8).optional(),
  workingObjective: z.string().trim().max(300).optional(),
  constraints: reviseConstraintsSchema.optional(),
  researchScope: researchScopeSchema.optional(),
  continuationPolicy: continuationPolicySchema.optional(),
  llmContextApproved: z.boolean().optional(),
}).strict();

export type ReviseResponsibilityInput = z.infer<typeof reviseResponsibilitySchema>;

export async function reviseMissionResponsibility(userId: string, id: string, raw: unknown) {
  const body = reviseResponsibilitySchema.parse(raw);
  const hash = jsonHash(body);

  return db.$transaction(async tx => {
    await tx.user.updateMany({where:{id:userId},data:{continuitySeq:{increment:0}}});
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

    let continuity = await effectiveContinuity(userId, { projectId: m.projectId, missionId: id }, tx);
    if (body.workingObjective !== undefined && body.workingObjective !== (currentSnapshot.workingObjective ?? "")) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const now = new Date();
      const directiveEvent = await tx.agentDirectiveEvent.create({
        data: {
          id: randomUUID(),
          ownerUserId: userId,
          projectId: m.projectId,
          missionId: id,
          seq: user.continuitySeq + 1,
          commandId: body.requestId,
          eventIndex: 0,
          inputHash: hash,
          directiveId: randomUUID(),
          kind: "WORKING_OBJECTIVE",
          operation: "SET",
          quote: body.workingObjective,
          sourceJson: json({ origin: "RESPONSIBILITY_REVISION", requestId: body.requestId }),
          admissionJson: json({ status: "DIRECT_APPLIED", kind: "WORKING_OBJECTIVE" }),
          sourceIdsJson: json([]),
          validFrom: now,
          timezone: "Asia/Shanghai",
        },
      });
      await tx.user.update({ where: { id: userId }, data: { continuitySeq: { increment: 1 } } });
      await invalidateContinuityConsumers(tx,userId,{projectId:m.projectId,missionId:id},[directiveEvent.id],false,[m.projectId],now,[id]);
      continuity = await effectiveContinuity(userId, { projectId: m.projectId, missionId: id }, tx);
    }

    let delegation = null;
    if (mergedPolicy.mode === "BOUNDED_INVESTIGATION") {
      const existingPlan = record(m.planJson);
      const existingDelegation = record(existingPlan.delegation);
      if (existingDelegation.policyHash || existingDelegation.wakeSeq !== undefined || existingDelegation.remoteSnapshots !== undefined) {
        // Reconcile delegation state: preserve execution watermarks, wake state, and observation history
        const validated = await initializeDelegation(tx,{...m,constraintsJson:json(mergedConstraints),researchScopeJson:json(mergedScope)},mergedPolicy);
        delegation = {
          ...existingDelegation,
          policyHash: jsonHash(mergedPolicy),
          connectionVersions: validated.connectionVersions,
          grantRunIds: validated.grantRunIds,
          grantBindings: validated.grantBindings,
          ...(body.continuationPolicy || body.researchScope ? {poll:null} : {}),
        };
      } else {
        const syntheticMission = {
          ...m,
          constraintsJson: json(mergedConstraints),
          researchScopeJson: json(mergedScope),
        };
        delegation = await initializeDelegation(tx, syntheticMission, mergedPolicy);
      }
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
      : m.status;

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
          continuityBinding: { intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash },
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
