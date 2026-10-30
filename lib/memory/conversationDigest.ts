import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { record, type Tx } from "@/lib/conversation/repository";
import type { ConversationActor, ConversationSource } from "@/lib/types/conversation";
import { memorySynthesisSchema, type MemorySynthesis } from "./synthesisContract";
import { assertProjectInputReadSet, type ProjectInputRef } from "./inputReadSet";
import { recordHypothesisUpdates, conversationHypothesisSources, composeHypotheses } from "./hypothesisService";

export async function conversationClaimHeads(tx: Tx, userId: string, projectId: string, conversationId: string) {
  return tx.agentClaim.findMany({ where: { ownerUserId: userId, projectId, missionId: null,
    OR: [{ conversationId: null }, { conversationId }] }, select: { id: true, currentRevision: true }, orderBy: { id: "asc" } });
}

/** Called only from the original fenced message publication, with that call's validated read set. */
export async function publishConversationDigest(tx: Tx, actor: ConversationActor, messageId: string, projectId: string,
  synthesis: MemorySynthesis, sources: ConversationSource[], allowedProjectIds: string[]) {
  const message = await tx.agentMessage.findFirst({ where: { id: messageId, ownerUserId: actor.userId, role: "ASSISTANT" }, include: { conversation: true, run: true } });
  if (!message?.conversation || !message.turnId || !allowedProjectIds.includes(projectId)) throw new AppError("MEMORY_ROOT_CHANGED", "原讨论与综合范围不匹配", 409);
  const turn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: message.turnId } });
  const coordination = record(record(turn.readManifestJson).coordination);
  if (!["OBSERVING", "GENERATING"].includes(turn.status) || !turn.leaseUntil || +turn.leaseUntil <= Date.now() ||
      coordination.state && coordination.state !== "ACTIVE") throw new AppError("MEMORY_ROOT_CHANGED", "原讨论已改变，未发布新的综合", 409);
  const body = memorySynthesisSchema.parse(synthesis);
  const sourceRevisionReadSet = record(turn.readManifestJson).sourceRevisionReadSet as ProjectInputRef[];
  if (!Array.isArray(sourceRevisionReadSet) || !sourceRevisionReadSet.length) throw new AppError("COGNITIVE_RECOORDINATE", "缺少原讨论输入版本，请重新核对", 409);
  await assertProjectInputReadSet(actor.userId, sourceRevisionReadSet, tx);
  const { validateReadSources } = await import("@/lib/conversation/service");
  await validateReadSources({ ...actor, conversationId: message.conversationId! }, sources, tx);
  for (const commitment of body.commitments) {
    if (commitment.actionId && !await tx.actionItem.findFirst({ where: { id: commitment.actionId, projectId, isSimulated: false } }))
      throw new AppError("MEMORY_COMMITMENT_CHANGED", "关联行动不属于本次综合范围", 409);
    if (commitment.missionId && !await tx.agentMission.findFirst({ where: { id: commitment.missionId, projectId, ownerUserId: actor.userId,
      project: { memberships: { some: { userId: actor.userId, role: "OWNER" } } } } })) throw new AppError("MEMORY_COMMITMENT_CHANGED", "原委托不可访问", 409);
  }
  const scope = { projectId, conversationId: message.conversationId! }, continuity = await effectiveContinuity(actor.userId, scope, tx);
  if (continuity.stopped) throw new AppError("DIRECTIVE_STOPPED", "工作已停止", 409);
  await recordHypothesisUpdates(tx, { kind: "MESSAGE", id: messageId, userId: actor.userId, projectId,
    conversationId: message.conversationId!, allowedProjectIds, sourceRevisionReadSet }, body.hypotheses, conversationHypothesisSources(sources));
  const cognitiveReadSet = (await composeHypotheses(actor.userId, projectId, allowedProjectIds, tx)).readSet;
  const heads = await conversationClaimHeads(tx, actor.userId, projectId, scope.conversationId);
  const compilerSpecVersion = "original-conversation-synthesis-v1", scopeKey = jsonHash(scope);
  const inputHash = jsonHash({ body, sources: sources.map(s => ({ projectId: s.projectId, sourceId: s.sourceId, revision: s.revision })), heads,
    sourceRevisionReadSet, intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash, compilerSpecVersion });
  return tx.agentContextDigest.upsert({ where: { ownerUserId_scopeKey_inputHash: { ownerUserId: actor.userId, scopeKey, inputHash } }, update: {},
    create: { ownerUserId: actor.userId, projectId, conversationId: message.conversationId, scopeKey, inputHash,
      originJson: { kind: "MESSAGE", id: messageId, generation: coordination.generation ?? 0,
        allowedProjectIds, observedProjectIds: record(message.blocksJson).observedProjectIds ?? [], sourceRevisionReadSet, cognitiveReadSet },
      sourceManifestJson: json(sources), claimHeadsJson: json(heads), intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash,
      compilerSpecVersion, budgetRootJson: { conversationId: message.conversationId, turnId: message.turnId, agentRunId: message.runId,
        additionalModelCalls: 0, policy: "SYNTHESIS_IN_ORIGINAL_ANSWER_CALL" }, provider: message.run?.provider ?? null, summaryJson: json(body) } });
}

/** Snapshot reuse is a read; no expired human session is synthesized and no new network grant is inferred. */
export async function validateConversationDigest(tx: Tx, userId: string, projectId: string, conversationId: string, origin: unknown, manifest: unknown) {
  const ref = record(origin), message = typeof ref.id === "string" ? await tx.agentMessage.findFirst({ where: { id: ref.id, conversationId, ownerUserId: userId }, include: { conversation: true } }) : null;
  if (!message?.conversation || !Array.isArray(manifest)) return { current: false, restricted: true, reason: "ORIGIN_UNAVAILABLE" };
  const blocks = record(message.blocksJson), dependencies = Array.isArray(blocks.observedProjectIds) ? blocks.observedProjectIds.filter((p): p is string => typeof p === "string") : [projectId];
  const members = await tx.projectMembership.findMany({ where: { userId, projectId: { in: dependencies } } });
  if (dependencies.some(p => !members.some(m => m.projectId === p))) return { current: false, restricted: true, reason: "PROJECT_PERMISSION_CHANGED" };
  const refs = Array.isArray(blocks.refs) ? blocks.refs : [];
  if (refs.some(raw => { const r = record(raw); return ["MISSION", "GOAL_QUESTION", "IMPACT"].includes(String(r.kind)) && !members.some(m => m.projectId === r.projectId && m.role === "OWNER"); }))
    return { current: false, restricted: true, reason: "PRIVATE_SOURCE_PERMISSION_CHANGED" };
  const original = Array.isArray(blocks.sources) ? blocks.sources : [];
  for (const raw of manifest) {
    const s = raw as unknown as ConversationSource;
    if (!s || typeof s.sourceId !== "string" || typeof s.projectId !== "string" || !original.some(p => jsonHash(p) === jsonHash(s))) return { current: false, restricted: false, reason: "MANIFEST_CHANGED" };
    if ((await sourceUse(userId, s.projectId, s.sourceId, tx, { conversationId })).state !== "ALLOWED") return { current: false, restricted: false, reason: "SOURCE_UNAVAILABLE" };
    if (s.repository) await (await import("@/lib/sensing/repoCiObservations")).validateRepositoryObservation(userId, s.projectId, s.sourceId, s.revision, tx);
    else if (s.document) await (await import("@/lib/documents/observations")).validateDocumentObservation(userId, s.projectId, s.sourceId, s.revision, tx);
    else if (!s.external) {
      const mission = s.sourceId.startsWith("mission:") ? await tx.agentMission.findFirst({ where: { id: s.sourceId.slice(8), projectId: s.projectId, ownerUserId: userId,
        project: { memberships: { some: { userId, role: "OWNER" } } } } }) : null;
      if (s.sourceId.startsWith("mission:") && !mission) return { current: false, restricted: true, reason: "PRIVATE_SOURCE_PERMISSION_CHANGED" };
      const hash = mission ? mission.version.toString() : await sourceHash(s.projectId, s.sourceId, tx);
      if (hash !== s.revision) return { current: false, restricted: false, reason: "SOURCE_CHANGED" };
    }
  }
  return { current: true, restricted: false, reason: "CURRENT" };
}
