import { db } from "@/lib/db";
import { record } from "@/lib/conversation/repository";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { isFeatureEnabled } from "@/lib/config/features";
import { jsonHash, usageOf } from "./contracts";
import { ownedMission } from "./repository";
import { missionWorkState } from "./workState";

/** One snapshot of the original responsibility. This read grants no execution permission. */
export async function readMissionResponsibility(userId: string, id: string) {
  return db.$transaction(async tx => {
    const m = await ownedMission(userId, id, tx);
    const [continuity, events, approvals] = await Promise.all([
      effectiveContinuity(userId, { projectId: m.projectId, missionId: id }, tx),
      tx.agentMissionEvent.findMany({ where: { missionId: id }, orderBy: { seq: "desc" }, take: 21 }),
      tx.agentMissionApproval.findMany({ where: { missionId: id, status: "PENDING" }, orderBy: { id: "asc" }, take: 10 }),
    ]);
    const policy = record(m.continuationPolicyJson), constraints = record(m.constraintsJson);
    const state = missionWorkState({ ...m, events, approvals, delegationEnabled: isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false) });
    const expired = policy.mode === "BOUNDED_INVESTIGATION" && !(Date.parse(String(policy.expiresAt)) > Date.now());
    const active = !continuity.stopped && !expired && !["SUCCEEDED", "CANCELLED", "PAUSED", "FAILED"].includes(m.status) && !m.pauseRequestedAt && !m.cancelRequestedAt;
    const controlVersion = jsonHash({ missionId: id, version: m.version, contextVersion: m.contextVersion, planRevision: m.planRevision,
      constraintsVersion: m.constraintsVersion, researchScopeVersion: m.researchScopeVersion,
      continuationPolicy: m.continuationPolicyJson, intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash,
      stopped: continuity.stopped, expired });
    return {
      schemaVersion: 1 as const, missionId: id, projectId: m.projectId, controlVersion,
      goal: m.goal, successCriteria: m.successCriteriaJson, workingObjective: continuity.workingObjective,
      constraints: m.constraintsJson, researchScope: m.researchScopeJson, continuationPolicy: m.continuationPolicyJson,
      deadline: typeof constraints.deadline === "string" ? constraints.deadline : null,
      permissionExpiresAt: typeof policy.expiresAt === "string" ? policy.expiresAt : null,
      permissionState: continuity.stopped ? "STOPPED" : expired ? "EXPIRED" : "WITHIN_TIME_BOUNDARY",
      budget: { limits: m.budgetJson, cumulativeUsed: usageOf(m.budgetUsedJson), additionalUsed: m.budgetUsedJson,
        policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE", monetaryCost: null },
      workState: state,
      // A schedule is not worker liveness or a promise of successful observation.
      nextCheckAt: active && policy.mode === "BOUNDED_INVESTIGATION" && state.phase === "WAITING_OBSERVATION" ? state.nextCheckAt : null,
      workerPresence: "UNOBSERVED" as const,
      activity: events.slice(0, 20).map(e => ({ id: e.id, sequence: e.seq, kind: e.type, at: e.createdAt.toISOString() })),
      coverage: { activityHasMore: events.length > 20 }, authority: "ORIGINAL_MISSION_READ_ONLY_PROJECTION" as const,
    };
  });
}
