import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Tx } from "@/lib/conversation/repository";
import { record } from "@/lib/conversation/repository";
import type { ConversationSource } from "@/lib/types/conversation";
import { conversationClaimHeads, validateConversationDigest } from "./conversationDigest";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { sourceHash, validateSources } from "@/lib/mission/repository";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import { memorySynthesisSchema, type MemorySynthesis } from "./synthesisContract";
import { assertProjectInputReadSet } from "./inputReadSet";
import { assertCognitiveReadSet, composeHypotheses } from "./hypothesisService";

const compilerVersion = "original-reasoning-synthesis-v1";
/** Caller is the original fenced output commit. All rows and cache publish share that transaction. */
export async function publishMissionDigest(tx: Tx, missionId: string, outputId: string, summary: MemorySynthesis, sources: Source[]) {
  const mission = await tx.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const output = await tx.agentMissionOutput.findFirst({ where: { id: outputId, missionId } });
  if (!output) throw new AppError("MEMORY_ORIGIN_MISSING", "原调查成果不存在，未保存综合", 409);
  const step = output.stepId ? await tx.agentMissionStep.findFirst({ where: { id: output.stepId, missionId }, include: { agentRun: true } }) : null;
  if (!step || step.planRevision !== mission.planRevision || step.status !== "RUNNING" || mission.status !== "RUNNING" ||
      !mission.leaseUntil || +mission.leaseUntil <= Date.now() || mission.pauseRequestedAt || mission.cancelRequestedAt)
    throw new AppError("MEMORY_ROOT_CHANGED", "原调查执行状态已变化，未发布新的综合", 409);
  const synthesis = memorySynthesisSchema.parse(summary);
  const sourceRevisionReadSet = record(step.protocolJson).sourceRevisionReadSet;
  if (!Array.isArray(sourceRevisionReadSet) || !sourceRevisionReadSet.length) throw new AppError("COGNITIVE_RECOORDINATE", "缺少原调查输入版本，请重新调查", 409);
  await assertProjectInputReadSet(mission.ownerUserId, sourceRevisionReadSet, tx);
  const cognitiveReadSet = (await composeHypotheses(mission.ownerUserId, mission.projectId, [mission.projectId], tx)).readSet;
  const roots = [...new Map(sources.map(s => [s.id, s])).values()];
  if (roots.length > 64) throw new AppError("MEMORY_SOURCE_LIMIT", "综合依据过多，请按问题拆分并保留原来源", 422);
  for (const c of synthesis.commitments) {
    if (c.actionId) {
      const action = await tx.actionItem.findFirst({ where: { id: c.actionId, projectId: mission.projectId, isSimulated: false } });
      if (!action) throw new AppError("MEMORY_COMMITMENT_CHANGED", "关联行动不存在或只是模拟数据", 409);
      const id = "action:" + action.id, hash = await sourceHash(mission.projectId, id, tx);
      if (!hash) throw new AppError("MEMORY_COMMITMENT_CHANGED", "原行动状态无法核对", 409);
      if (!roots.some(s => s.id === id)) roots.push({ id, hash, revision: hash, kind: "PROJECT", entityType: "ACTION",
        text: action.title, observedAt: new Date().toISOString(), knowledgeClass: "PROJECT_OBSERVATION" });
    }
    if (c.missionId && !await tx.agentMission.findFirst({ where: { id: c.missionId, projectId: mission.projectId, ownerUserId: mission.ownerUserId } }))
      throw new AppError("MEMORY_COMMITMENT_CHANGED", "关联委托不存在或不可访问", 409);
  }
  if (roots.length > 64) throw new AppError("MEMORY_SOURCE_LIMIT", "综合依据超过当前范围，请拆分问题", 422);
  await validateSources(mission.projectId, roots, tx, missionId);
  const scope = { projectId: mission.projectId, missionId }, continuity = await effectiveContinuity(mission.ownerUserId, scope, tx);
  if (continuity.stopped) throw new AppError("DIRECTIVE_STOPPED", "工作已停止，未发布新的综合", 409);
  const heads = await tx.agentClaim.findMany({ where: { ownerUserId: mission.ownerUserId, projectId: mission.projectId,
    conversationId: null, OR: [{ missionId: null }, { missionId }] }, select: { id: true, currentRevision: true }, orderBy: { id: "asc" } });
  const scopeKey = jsonHash(scope), inputHash = jsonHash({ synthesis, roots: roots.map(s => ({ id: s.id, hash: s.hash })).sort((a,b) => a.id.localeCompare(b.id)),
    heads, sourceRevisionReadSet, intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash, compilerVersion });
  return tx.agentContextDigest.upsert({ where: { ownerUserId_scopeKey_inputHash: { ownerUserId: mission.ownerUserId, scopeKey, inputHash } },
    update: {}, create: { ownerUserId: mission.ownerUserId, projectId: mission.projectId, missionId, scopeKey, inputHash,
      originJson: json({ kind: "MISSION_OUTPUT", id: outputId, revision: output.revision, sourceRevisionReadSet, cognitiveReadSet }), sourceManifestJson: json(roots), claimHeadsJson: json(heads),
      intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash, compilerSpecVersion: compilerVersion,
      provider: step.agentRun?.provider ?? null,
      budgetRootJson: { missionId, stepId: output.stepId, agentRunId: step.agentRunId, additionalModelCalls: 0, policy: "SYNTHESIS_IN_ORIGINAL_OUTPUT_CALL" },
      summaryJson: json(synthesis) } });
}

/** Pure read: stale summaries remain history, never silently recompiled or promoted to original evidence. */
export async function readEffectiveDigests(userId: string, projectId: string, tx: Tx = db) {
  if (!await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId } } }))
    throw new AppError("PROJECT_NOT_FOUND", "项目不存在或不可访问", 404);
  const rows = await tx.agentContextDigest.findMany({ where: { ownerUserId: userId, projectId }, orderBy: { createdAt: "desc" }, take: 9 });
  const items = [];
  for (const digest of rows.slice(0, 8)) {
    const scope = { projectId, ...(digest.missionId ? { missionId: digest.missionId } : {}), ...(digest.conversationId ? { conversationId: digest.conversationId } : {}) };
    const continuity = await effectiveContinuity(userId, scope, tx);
    let current = digest.statusProjection === "CURRENT" && digest.intentHash === continuity.intentHash && digest.reusePolicyHash === continuity.reusePolicyHash;
    let reason = current ? "CURRENT" : "CONTEXT_CHANGED";
    try {
      const readSet = record(digest.originJson).sourceRevisionReadSet;
      if (!Array.isArray(readSet) || !readSet.length) throw new Error("INPUT_VERSION_UNKNOWN");
      await assertProjectInputReadSet(userId, readSet, tx);
      await assertCognitiveReadSet(userId, record(digest.originJson).cognitiveReadSet, tx);
    } catch { current = false; reason = "PROJECT_INPUT_CHANGED"; }
    const sources = Array.isArray(digest.sourceManifestJson) ? digest.sourceManifestJson as unknown as Source[] : [];
    if (!Array.isArray(digest.sourceManifestJson)) { current = false; reason = "LINEAGE_UNKNOWN"; }
    const mission = digest.missionId ? await tx.agentMission.findFirst({ where: { id: digest.missionId, projectId, ownerUserId: userId,
      project: { memberships: { some: { userId, role: "OWNER" } } } } }) : null;
    let restricted = false;
    if (digest.conversationId) {
      const state = await validateConversationDigest(tx, userId, projectId, digest.conversationId, digest.originJson, digest.sourceManifestJson)
        .catch(() => ({ current: false, restricted: true, reason: "REVALIDATION_UNAVAILABLE" }));
      restricted = state.restricted;
      if (!state.current) { current = false; reason = state.reason; }
    } else if (!mission || !await tx.agentMissionOutput.findFirst({ where: { id: String(record(digest.originJson).id), missionId: mission.id } })) {
      current = false; reason = "ORIGIN_UNAVAILABLE"; restricted = true;
    }
    if (current) try {
      if (!digest.conversationId) {
        await validateSources(projectId, sources, tx, digest.missionId ?? undefined);
        for (const source of sources) if ((await sourceUse(userId, projectId, source.id, tx, scope)).state !== "ALLOWED") throw new Error("SOURCE_UNAVAILABLE");
      }
      const heads = digest.conversationId ? await conversationClaimHeads(tx, userId, projectId, digest.conversationId) : await tx.agentClaim.findMany({ where: { ownerUserId: userId, projectId, conversationId: null,
        OR: [{ missionId: null }, { missionId: digest.missionId }] }, select: { id: true, currentRevision: true }, orderBy: { id: "asc" } });
      if (jsonHash(heads) !== jsonHash(digest.claimHeadsJson)) throw new Error("CLAIM_CHANGED");
    } catch (error) { current = false; reason = error instanceof AppError || error instanceof Error && ["CLAIM_CHANGED", "SOURCE_UNAVAILABLE"].includes(error.message)
      ? "SOURCE_OR_CLAIM_CHANGED" : "REVALIDATION_UNAVAILABLE"; }
    const synthesis = memorySynthesisSchema.safeParse(digest.summaryJson);
    if (!synthesis.success) { current = false; reason = "INVALID_SYNTHESIS"; }
    const commitments = [];
    if (synthesis.success && !restricted) for (const c of synthesis.data.commitments) {
      const action = c.actionId ? await tx.actionItem.findFirst({ where: { id: c.actionId, projectId, isSimulated: false } }) : null;
      const originalMission = c.missionId ? await tx.agentMission.findFirst({ where: { id: c.missionId, projectId, ownerUserId: userId,
        project: { memberships: { some: { userId, role: "OWNER" } } } } }) : null;
      if (c.missionId && !originalMission) { restricted = true; current = false; reason = "PRIVATE_SOURCE_PERMISSION_CHANGED"; }
      commitments.push({ ...c, actionStatus: action?.status ?? null, resultCardId: action?.resultCardId ?? null, missionStatus: originalMission?.status ?? null,
        authority: "ORIGINAL_RECEIPT_STATE" });
    }
    const conversationSources = digest.conversationId ? digest.sourceManifestJson as unknown as ConversationSource[] : [];
    items.push({ id: digest.id, effectiveState: restricted ? "RESTRICTED" : current ? "CURRENT" : "STALE", reason, origin: restricted ? null : digest.originJson,
      synthesis: synthesis.success && !restricted ? synthesis.data : null, commitments: restricted ? [] : commitments, createdAt: digest.createdAt.toISOString(),
      sourceRefs: restricted ? [] : digest.conversationId ? conversationSources.map(s => ({ id: s.sourceId, hash: s.revision, kind: s.external ? "EXTERNAL" : "PROJECT", projectId: s.projectId }))
        : sources.map(s => ({ id: s.id, hash: s.hash, kind: s.kind, projectId })), authority: "MODEL_SYNTHESIS_NOT_INDEPENDENT_EVIDENCE",
      scopeProjectIds: restricted ? [] : digest.conversationId ? (record(digest.originJson).allowedProjectIds as string[] ?? [projectId]) : [projectId],
      budgetRoot: restricted ? null : digest.budgetRootJson, nextBoundary: continuity.nextBoundary, sourceMissionId: restricted ? null : mission?.id ?? null,
      sourceConversationId: restricted ? null : digest.conversationId });
  }
  return { items, coverage: { loaded: items.length, hasMore: rows.length > 8 },
    usagePolicy: "历史综合用于导航和解释；新主张与操作须重新读取原始证据。综合、偏好、模型解释都不是授权。" };
}

export async function composeEffectiveMemory(userId: string, projectId: string, query: string, allowedProjectIds = [projectId]) {
  const view = await readEffectiveDigests(userId, projectId);
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) ?? [])];
  const candidates = view.items.filter(i => i.effectiveState === "CURRENT" && i.synthesis && i.scopeProjectIds.every(p => allowedProjectIds.includes(p)) && i.sourceRefs.every(s => allowedProjectIds.includes(s.projectId)));
  const rank = (item: typeof candidates[number]) => terms.filter(t => JSON.stringify(item.synthesis).toLowerCase().includes(t)).length;
  candidates.sort((a,b) => rank(b)-rank(a));
  const items = []; let characters = 0;
  for (const item of candidates) {
    const size = JSON.stringify(item).length;
    if (items.length < 2 && characters + size <= 9000) { items.push(item); characters += size; }
  }
  return { items, pointers: candidates.map(i => ({ id: i.id, sourceMissionId: i.sourceMissionId, sourceRefs: i.sourceRefs })),
    coverage: { complete: items.length === candidates.length && !view.coverage.hasMore, selected: items.length, candidates: candidates.length, characters },
    usagePolicy: view.usagePolicy };
}
