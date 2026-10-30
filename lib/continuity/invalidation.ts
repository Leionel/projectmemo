import type { Tx } from "@/lib/conversation/repository";
import { record } from "@/lib/conversation/repository";
import { json } from "@/lib/mission/contracts";
import type { DirectiveScope } from "@/lib/types/continuity";

/** Shared original control invalidation; caller holds the user write slot. */
export async function invalidateContinuityConsumers(tx: Tx, userId: string, scope: DirectiveScope, events: string[], stop = false, projectIds = [scope.projectId], now = new Date()) {
  // No Conversation.version change: the original in-flight turn retains its base-version slot.
  const active = await tx.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, conversation: { ownerUserId: userId } } });
  for (const t of active) {
    const m = record(t.readManifestJson), coord = record(m.coordination), scopes = coord.scopes as DirectiveScope[] | undefined;
    if (scopes?.some(s => projectIds.includes(s.projectId) && (!scope.conversationId || scope.conversationId === t.conversationId) && (!scope.missionId || s.missionId === scope.missionId)))
      await tx.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: json({ ...m, coordination: { ...coord,
        state: stop ? "STOPPING" : "INVALIDATED", invalidatedAt: now.toISOString(),
        drainDeadline: new Date(+now + 25000).toISOString(), pendingEvents: [...(coord.pendingEvents as string[] ?? []), ...events].slice(-64) } }) } });
  }
  const missions = await tx.agentMission.findMany({ where: { ownerUserId: userId, projectId: { in: projectIds },
    ...(scope.missionId ? { id: scope.missionId } : {}), status: { notIn: ["SUCCEEDED", "FAILED", "CANCELLED"] } } });
  if (!scope.conversationId) for (const m of missions) {
    const pause = ["RUNNING", "READY", "WAITING_APPROVAL"].includes(m.status);
    await tx.agentMissionApproval.updateMany({ where: { missionId: m.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMissionStep.updateMany({ where: { missionId: m.id, status: { in: ["READY", "PLANNED", "RUNNING", "WAITING_APPROVAL"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 },
      ...(pause ? { status: "PAUSED", pauseReason: "REVIEW_REQUIRED", executionSlot: null, leaseOwner: null, leaseUntil: null, leaseEpoch: { increment: 1 } } : {}),
      planJson: json({ ...record(m.planJson), continuityInvalidated: events, ...(pause ? { resumeStatus: "READY" } : {}) }) } });
  }
}
