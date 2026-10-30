import {missionWorkState} from "./workState";
import type {Prisma} from "@/lib/generated/prisma/client";
import {db} from "@/lib/db";
import {isFeatureEnabled} from "@/lib/config/features";
import {assertOwner} from "./repository";
import {missionToolLabels, type MissionWorkspaceSummary} from "./presentation";

/** Bounded, read-only projection of existing records. No model, evaluation or new lifecycle. */
export async function missionWorkspaceSummary(userId: string, projectId: string): Promise<MissionWorkspaceSummary> {
  await assertOwner(userId, projectId);
  if (!isFeatureEnabled("MISSION_ENABLED", false) || !isFeatureEnabled("MISSION_UI_ENABLED", true)) {
    return {enabled: false, totalActive: 0, items: []};
  }
  const attentionStates = ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED"];
  const where = {ownerUserId: userId, projectId, status: {notIn: ["SUCCEEDED", "CANCELLED"]}};
  const [waiting, running, totalActive] = await Promise.all([
    db.agentMission.findMany({where: {...where, status: {in: attentionStates}}, orderBy: {updatedAt: "desc"}, take: 3, select: missionSummarySelect}),
    db.agentMission.findMany({where: {...where, status: {notIn: [...attentionStates, "SUCCEEDED", "CANCELLED"]}}, orderBy: {updatedAt: "desc"}, take: 3, select: missionSummarySelect}),
    db.agentMission.count({where}),
  ]);
  const items = [...waiting, ...running].slice(0, 3).map(presentMissionSummary);
  return {enabled: true, totalActive, items};
}

export const missionSummarySelect = {
    id: true,planRevision:true,updatedAt:true, projectId:true, goal: true, status: true, version: true, lastErrorJson: true, waitStateJson:true, planJson:true, continuationPolicyJson:true, leaseUntil:true, nextAttemptAt:true,
    events: {where: {type: {in:["QUESTION","INVESTIGATION_NO_NEW_INFORMATION","INVESTIGATION_OBSERVATION_CHANGED"] as string[]}}, orderBy: {seq: "desc" as const}, take: 1, select: {id: true, type:true, payloadJson: true}},
    approvals: {where: {status: "PENDING"}, orderBy: {expiresAt: "asc" as const}, take: 1, select: {id: true, expiresAt:true, proposalJson: true}},
    steps: {where: {status: "SUCCEEDED"}, orderBy: {ordinal: "desc" as const}, take: 1, select: {toolName: true, finishedAt: true}},
    outputs: {orderBy: {revision: "desc" as const}, take: 1, select: {revision: true, createdAt: true}},
  } as const;

export function presentMissionSummary(m: Prisma.AgentMissionGetPayload<{select: typeof missionSummarySelect}>) {
    const workState=missionWorkState({...m,delegationEnabled:isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED",false)});
    const attention=workState.reasonText;
    const output = m.outputs[0], step = m.steps[0];
    const latestOutput = output && (!step?.finishedAt || output.createdAt >= step.finishedAt);
    return {id: m.id, goal: m.goal, status: m.status, version: m.version, attention, workState,
      activity: latestOutput ? `草稿修订 ${output.revision} 已保存` : step ? `${missionToolLabels[step.toolName] ?? "工具步骤"}已执行` : null,
      activityAt: latestOutput ? output.createdAt.toISOString() : step?.finishedAt?.toISOString() ?? null,
      outputRevision: output?.revision ?? null};

}
