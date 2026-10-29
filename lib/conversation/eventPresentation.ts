import { db } from "@/lib/db";
import { agentPresentationSchema, type AgentPresentation } from "@/lib/types/agentExperience";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";
import { jsonHash } from "@/lib/mission/contracts";
import { ownedMission, sourceHash } from "@/lib/mission/repository";
import { assertProject, ownedConversation, record } from "./repository";
import { isFeatureEnabled } from "@/lib/config/features";

/** Deterministic event screening has already happened in anchorSync. Reading this notice never calls a model. */
export async function eventPresentation(actor: ConversationActor, id: string, messageId: string, blocks: ConversationBlocks): Promise<AgentPresentation | undefined> {
  const notice = blocks.changeNotice;
  if (!notice || !isFeatureEnabled("FOCUS_AGENT_R4_ENABLED", false)) return;
  const conversation = await ownedConversation(actor, id);
  const projection = await db.conversationAnchorProjection.findUnique({ where: { anchorId_revisionKey: { anchorId: notice.anchorId, revisionKey: notice.revisionKey } }, include: { anchor: true } });
  if (!projection || projection.messageId !== messageId || projection.anchor.ownerUserId !== actor.userId || projection.anchor.conversationId !== id ||
    projection.anchor.missionId !== notice.missionId || jsonHash(record(record(projection.payloadJson).blocks).changeNotice) !== jsonHash(notice)) return;
  const projectId = projection.anchor.projectId;
  await assertProject(actor, projectId);
  const mission = await ownedMission(actor.userId, notice.missionId);
  const event = await db.agentMissionEvent.findFirst({ where: { id: notice.eventId, missionId: mission.id, type: "SOURCE_ARRIVED" } });
  if (!event || mission.projectId !== projectId || mission.goal !== notice.goalQuote) return;
  const pointer = record(record(event.payloadJson).sourcePointer);
  const source = blocks.sources.find(s => s.sourceId === pointer.id && s.revision === pointer.hash && s.projectId === projectId);
  if (!source || await sourceHash(projectId, source.sourceId) !== source.revision) return;
  const eventRef = { kind: "EVENT" as const, id: event.id, projectId, revision: jsonHash(event.payloadJson) };
  const anchorRef = { kind: "ANCHOR" as const, id: notice.anchorId, projectId, revision: String(projection.anchor.version) };
  const sourceRef = { kind: "SOURCE" as const, id: source.id, projectId, revision: source.revision };
  const bindingId = "discuss-event:" + event.id;
  return agentPresentationSchema.parse({ schemaVersion: 1, blocks: [{ blockKey: "event:" + event.id, semanticType: "change", emphasis: "primary",
    fallbackText: "原问题收到一份可能相关的资料", refs: [eventRef, anchorRef, sourceRef], actionBindingIds: [bindingId], goalQuote: mission.goal,
    changeKind: "原问题有了新资料", relevance: "这份资料与原委托当前等待的信息相关，可以继续核对适用条件。", disposition: "ATTEND",
    unknowns: ["资料相关不表示目标已经达成；原任务尚未接续。"] }], allowedActions: [{ bindingId, conversationId: id,
    expectedConversationVersion: conversation.version, actionKind: "ASK", target: eventRef, label: "调查这条变化", enabled: !conversation.activeTurnId,
    disabledReason: conversation.activeTurnId ? "请等本轮讨论结束" : null, frozen: null }] });
}
