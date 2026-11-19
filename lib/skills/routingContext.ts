import type { AgentMission } from "@/lib/generated/prisma/client";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { boundedPolicy } from "@/lib/mission/investigationDelegation";
import { record } from "@/lib/conversation/repository";
import type { Source } from "@/lib/mission/contracts";
import type { Tx } from "@/lib/mission/repository";
import type { EvidenceState, RoutingMission, SkillRoutingInput } from "./router";

/** Read-only projection of persisted Mission state into the router's input. Never trusts model claims. */
export async function buildRoutingInput(
  tx: Tx,
  mission: AgentMission,
  options: { message?: string; candidates?: SkillRoutingInput["candidateMissions"]; outputSourceRefs?: Source[]; changedSinceLastRun?: boolean } = {},
): Promise<SkillRoutingInput> {
  const [project, captures, attachments, outputs, events, continuity, priorReads] = await Promise.all([
    tx.project.findUnique({ where: { id: mission.projectId }, select: { id: true, title: true } }),
    tx.capture.findMany({ where: { projectId: mission.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 24, select: { id: true, rawText: true } }),
    tx.attachment.findMany({ where: { projectId: mission.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 12, select: { id: true, fileName: true } }),
    tx.agentMissionOutput.findMany({ where: { missionId: mission.id }, orderBy: { revision: "desc" }, take: 1, select: { id: true, sourceRefsJson: true } }),
    tx.agentMissionEvent.count({ where: { missionId: mission.id, type: "SOURCE_ARRIVED", seq: { gt: 0 } } }),
    effectiveContinuity(mission.ownerUserId, { projectId: mission.projectId, missionId: mission.id }, tx),
    tx.agentMissionStep.count({ where: { missionId: mission.id, status: "SUCCEEDED", toolName: { in: ["read_project_material", "inspect_project", "search_memory"] } } }),
  ]);
  const readableSources = captures.filter(capture => capture.rawText.trim().length > 0).length;
  const outputRefs = options.outputSourceRefs ?? ((outputs[0]?.sourceRefsJson as unknown as Source[] | null) ?? []);
  // Evidence is about what this Mission read, not about material merely existing in the project.
  const evidence: EvidenceState = outputRefs.length ? "VALID" : priorReads > 0 ? "PARTIAL" : "NONE";
  const sourceCount = captures.length + attachments.length;
  const researchScope = record(mission.researchScopeJson);
  const policy = boundedPolicy(mission);
  const routingMission: RoutingMission = {
    id: mission.id, projectId: mission.projectId, goal: mission.goal, status: mission.status,
    runtimeProtocolVersion: mission.runtimeProtocolVersion,
    workingObjective: continuity.workingObjective,
    evidence, outputId: outputs[0]?.id ?? null, outputCount: outputs.length,
    sourceCount, skillStage: (record(record(mission.planJson).skillCursor).stage as RoutingMission["skillStage"]) ?? null,
  };
  return {
    // A current user directive adjusts the mission; it does not replace the mission goal.
    message: options.message ?? (continuity.workingObjective ? mission.goal + "；当前工作重点：" + continuity.workingObjective : mission.goal),
    event: events > 0 ? "SOURCE_REVISED" : "USER_MESSAGE",
    mission: routingMission,
    candidateMissions: options.candidates ?? [],
    project: project ? { id: project.id, title: project.title, sourceCount, readableSources } : null,
    permission: {
      ownerMatches: true, projectAccessible: true, hasReadableMaterial: readableSources + attachments.length > 0,
      publicResearch: researchScope.enabled === true, publicTerms: Array.isArray(researchScope.publicTerms) ? (researchScope.publicTerms as string[]) : [],
      connectedSourceIds: policy?.connectionIds ?? [], allowedToolNames: policy?.allowedTools ?? [],
      externalApprovalRequired: false,
    },
    activity: { evidence, latestOutputId: outputs[0]?.id ?? null, outputCount: outputs.length, newSourceEvents: events,
      changedSinceLastRun: options.changedSinceLastRun ?? false },
  };
}
