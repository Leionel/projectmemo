import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record, type Tx } from "@/lib/conversation/repository";
import { json, jsonHash, type Source } from "@/lib/mission/contracts";
import { sourceHash, validateSources } from "@/lib/mission/repository";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
import type { ConversationSource } from "@/lib/types/conversation";
import { validateConversationDigest } from "./conversationDigest";
import { hypothesisUpdateSchema, type HypothesisUpdate } from "./synthesisContract";
import { assertProjectInputReadSet, type ProjectInputRef } from "./inputReadSet";

export type CognitiveRoot = { kind: "MISSION_OUTPUT" | "MESSAGE"; id: string; userId: string; projectId: string;
  missionId?: string; conversationId?: string; allowedProjectIds: string[]; sourceRevisionReadSet: ProjectInputRef[] };
export type CognitiveReadRef = { claimId: string; projectId: string; revision: number; validityHash: string };
type EvidenceInput = { aliases: string[]; projectId: string; text: string; knowledgeClass?: string; entityType?: string;
  snapshot: Source | ConversationSource; format: "MISSION" | "CONVERSATION" };
export function missionHypothesisSources(projectId: string, sources: Source[]): EvidenceInput[] {
  return sources.map(s => ({ aliases: [s.id], projectId, text: s.text, knowledgeClass: s.knowledgeClass, entityType: s.entityType, snapshot: s, format: "MISSION" }));
}
export function conversationHypothesisSources(sources: ConversationSource[]): EvidenceInput[] {
  return sources.map(s => ({ aliases: [s.id, s.sourceId], projectId: s.projectId, text: s.excerpt, knowledgeClass: s.knowledgeClass,
    entityType: s.sourceId.startsWith("card:") ? "CARD" : s.sourceId.startsWith("artifact:") ? "ARTIFACT" : undefined, snapshot: s, format: "CONVERSATION" }));
}

/** An append-only cognitive write inside the original fenced publication, never a task or authorization. */
export async function recordHypothesisUpdates(tx: Tx, root: CognitiveRoot, updates: HypothesisUpdate[], available: EvidenceInput[]) {
  await assertProjectInputReadSet(root.userId, root.sourceRevisionReadSet, tx);
  if (root.kind === "MISSION_OUTPUT") {
    const output = await tx.agentMissionOutput.findFirst({ where: { id: root.id, missionId: root.missionId, mission: { projectId: root.projectId, ownerUserId: root.userId } }, include: { mission: true, } });
    if (!output || output.mission.status !== "RUNNING" || !output.mission.leaseUntil || +output.mission.leaseUntil <= Date.now()) throw new AppError("MEMORY_ROOT_CHANGED", "原调查已改变，未保存判断", 409);
  } else {
    const message = await tx.agentMessage.findFirst({ where: { id: root.id, ownerUserId: root.userId, conversationId: root.conversationId, role: "ASSISTANT" } });
    const turn = message?.turnId ? await tx.conversationTurn.findUnique({ where: { id: message.turnId } }) : null;
    if (!turn || !["OBSERVING", "GENERATING"].includes(turn.status) || !turn.leaseUntil || +turn.leaseUntil <= Date.now()) throw new AppError("MEMORY_ROOT_CHANGED", "原讨论已改变，未保存判断", 409);
  }
  const scope = { projectId: root.projectId, ...(root.missionId ? { missionId: root.missionId } : {}), ...(root.conversationId ? { conversationId: root.conversationId } : {}) };
  const continuity = await effectiveContinuity(root.userId, scope, tx);
  if (continuity.stopped) throw new AppError("DIRECTIVE_STOPPED", "工作已停止，未保存新的判断", 409);
  const changed = [];
  for (const [index, raw] of updates.entries()) {
    const update = hypothesisUpdateSchema.parse(raw), requestId = `model:${root.kind}:${root.id}:${index}`, payloadHash = jsonHash(update);
    const replay = await tx.agentClaimEvent.findUnique({ where: { ownerUserId_requestId: { ownerUserId: root.userId, requestId } } });
    if (replay) { if (replay.payloadHash !== payloadHash) throw new AppError("REQUEST_CONFLICT", "原判断回执与本次内容不同", 409); changed.push(replay.claimId); continue; }
    let claim = update.claimId ? await tx.agentClaim.findFirst({ where: { id: update.claimId, ownerUserId: root.userId, scopeType: "PROJECT", projectId: root.projectId, kind: "HYPOTHESIS" } }) : null;
    if (update.claimId && (!claim || claim.currentRevision !== update.expectedRevision)) throw new AppError("COGNITIVE_RECOORDINATE", "原推测已更新，需要重读后继续", 409);
    if (claim) {
      const prior = (await readHypotheses(root.userId, root.projectId, tx, [claim.id])).items[0];
      if (!prior || prior.effectiveStatus === "RESTRICTED") throw new AppError("SOURCE_USE_SUPPRESSED", "原判断当前不可复用，请重新核对来源和范围", 409);
    }
    const claimId = claim?.id;
    if (claimId && continuity.directives.some(d => d.kind === "USE_SUPPRESSION" && d.sourceIds.includes("claim:" + claimId)))
      throw new AppError("SOURCE_USE_SUPPRESSED", "你已停止使用这个判断，请先撤回该限制", 409);
    if (!update.claimId && update.expectedRevision) throw new AppError("INVALID_HYPOTHESIS_REVISION", "新推测不能携带旧版本", 422);
    const evidence = [];
    for (const requested of update.evidence) {
      const source = available.find(s => s.aliases.includes(requested.sourceId));
      if (!source || !root.allowedProjectIds.includes(source.projectId)) continue;
      const sourceId = source.format === "MISSION" ? (source.snapshot as Source).id : (source.snapshot as ConversationSource).sourceId;
      const policy = await sourceUse(root.userId, source.projectId, sourceId, tx, scope);
      const start = source.text.indexOf(requested.quote), exact = start >= 0 && source.text.indexOf(requested.quote, start + 1) < 0;
      const supporting = policy.state === "ALLOWED" && policy.independentEvidence && exact && source.knowledgeClass !== "INFERENCE" && !["CARD", "ARTIFACT"].includes(source.entityType ?? "");
      evidence.push({ sourceId, projectId: source.projectId, role: requested.role, quote: requested.quote, start: exact ? start : null,
        end: exact ? start + requested.quote.length : null, qualified: supporting, format: source.format, snapshot: source.snapshot });
    }
    const supports = evidence.some(e => e.role === "SUPPORT" && e.qualified), counters = evidence.some(e => e.role === "COUNTER" && e.qualified);
    let state = update.state;
    if (state === "SUPPORTED" && (!supports || counters) || state === "REFUTED" && (!counters || supports)) state = "INCONCLUSIVE";
    const validUntil = update.validUntil ? new Date(update.validUntil) : new Date(Date.now() + 7 * 86400000);
    if (+validUntil <= Date.now()) state = "EXPIRED";
    if (!claim) claim = await tx.agentClaim.create({ data: { ownerUserId: root.userId, projectId: root.projectId,
      scopeKey: jsonHash({ projectId: root.projectId }), missionId: root.missionId, conversationId: root.conversationId,
      originKey: `${root.kind}:${root.id}:${index}`, originJson: json(root), kind: "HYPOTHESIS", canonicalStatement: update.statement,
      conditionsJson: json(update.conditions), statusProjection: state } });
    const revision = update.claimId ? claim.currentRevision + 1 : 1;
    await tx.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: root.userId, revision, requestId, payloadHash,
      eventKind: update.claimId ? "MODEL_ASSESSMENT" : "MODEL_PROPOSED", actorKind: "MODEL", targetHash: jsonHash({ root, update }),
      modelInterpretation: update.explanation, evidenceManifestJson: json(evidence), validUntil,
      assessmentJson: json({ root, scope, intentHash: continuity.intentHash, reusePolicyHash: continuity.reusePolicyHash,
        statement: update.statement, conditions: update.conditions, requestedState: update.state, effectiveState: state,
        explanation: update.explanation, nextInformationNeed: state !== update.state && !update.nextInformationNeed ? "重新读取独立原始证据，核对支持与反例" : update.nextInformationNeed,
        qualificationReason: state !== update.state ? "支持不足、证据相互冲突或有效期已过，未采用模型请求的状态" : null,
        basis: "CONDITIONAL_MODEL_ASSESSMENT_NOT_FACT_VERIFICATION", evidenceQualified: supports || counters }) } });
    await tx.agentClaim.update({ where: { id: claim.id }, data: { currentRevision: revision, statusProjection: state,
      canonicalStatement: update.statement, conditionsJson: json(update.conditions) } });
    changed.push(claim.id);
  }
  return changed;
}

export async function readHypotheses(userId: string, projectId: string, tx: Tx = db, ids?: string[]) {
  const member = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId } } });
  if (!member) throw new AppError("PROJECT_NOT_FOUND", "项目不存在或不可访问", 404);
  const claims = await tx.agentClaim.findMany({ where: { ownerUserId: userId, scopeType: "PROJECT", projectId, kind: "HYPOTHESIS", ...(ids ? { id: { in: ids.slice(0, 16) } } : {}) },
    orderBy: { updatedAt: "desc" }, take: 17 });
  const items = [];
  for (const claim of claims.slice(0, 16)) {
    const event = await tx.agentClaimEvent.findUnique({ where: { claimId_revision: { claimId: claim.id, revision: claim.currentRevision } } });
    const assessment = record(event?.assessmentJson), root = record(assessment.root), scope = record(assessment.scope);
    const evidence = Array.isArray(event?.evidenceManifestJson) ? event.evidenceManifestJson.map(record) : [];
    const history = await tx.agentClaimEvent.findMany({ where: { claimId: claim.id }, orderBy: { revision: "desc" }, take: 65, select: { assessmentJson: true, revision: true, createdAt: true } });
    const dependencyProjects = [...new Set([projectId, ...history.flatMap(e => {
      const projects = record(record(e.assessmentJson).root).allowedProjectIds;
      return Array.isArray(projects) ? projects.filter((p): p is string => typeof p === "string") : [];
    })])];
    const members = await tx.projectMembership.findMany({ where: { userId, projectId: { in: dependencyProjects } } });
    let restricted = dependencyProjects.some(p => !members.some(m => m.projectId === p)) || history.length > 64, valid = !!event, reuseAllowed = true;
    const current = await effectiveContinuity(userId, { projectId, ...(typeof scope.missionId === "string" ? { missionId: scope.missionId } : {}),
      ...(typeof scope.conversationId === "string" ? { conversationId: scope.conversationId } : {}) }, tx);
    if (current.intentHash !== assessment.intentHash || current.reusePolicyHash !== assessment.reusePolicyHash || current.stopped || event?.validUntil && +event.validUntil <= Date.now()) valid = false;
    try {
      if (!Array.isArray(root.sourceRevisionReadSet) || !root.sourceRevisionReadSet.length) valid = false;
      await assertProjectInputReadSet(userId, root.sourceRevisionReadSet, tx);
    } catch { valid = false; }
    for (const root of [record(claim.originJson), ...history.map(e => record(record(e.assessmentJson).root))]) if (root.kind === "MISSION_OUTPUT") {
      const original = await tx.agentMissionOutput.findFirst({ where: { id: String(root.id), mission: { projectId, ownerUserId: userId,
        project: { memberships: { some: { userId, role: "OWNER" } } } } } });
      if (!original) { restricted = true; valid = false; }
    } else if (root.kind === "MESSAGE") {
      const original = await tx.agentMessage.findFirst({ where: { id: String(root.id), ownerUserId: userId, conversationId: String(root.conversationId) } });
      if (!original) { restricted = true; valid = false; }
      else { const privacy = await validateConversationDigest(tx, userId, projectId, String(root.conversationId), { id: root.id }, []); restricted ||= privacy.restricted; }
    } else valid = false;
    const reuse = await sourceUse(userId, projectId, "claim:" + claim.id, tx, { missionId: typeof root.missionId === "string" ? root.missionId : undefined,
      conversationId: typeof root.conversationId === "string" ? root.conversationId : undefined });
    if (reuse.state === "SUPPRESSED") { reuseAllowed = false; valid = false; }
    const sourceStates = [];
    if (!restricted) for (const entry of evidence) {
      const snapshot = record(entry.snapshot), p = String(entry.projectId), sourceId = String(entry.sourceId);
      try {
        const use = await sourceUse(userId, p, sourceId, tx, { missionId: typeof root.missionId === "string" ? root.missionId : undefined,
          conversationId: typeof root.conversationId === "string" ? root.conversationId : undefined });
        if (use.state !== "ALLOWED") valid = false;
        if (use.state === "SUPPRESSED") reuseAllowed = false;
        if (entry.format === "MISSION") await validateSources(p, [snapshot as unknown as Source], tx, typeof root.missionId === "string" ? root.missionId : undefined);
        else {
          const state = await validateConversationDigest(tx, userId, projectId, String(root.conversationId), { id: root.id }, [snapshot]);
          if (!state.current) valid = false; restricted ||= state.restricted;
        }
        sourceStates.push({ sourceId, hash: await sourceHash(p, sourceId, tx) ?? snapshot.hash ?? snapshot.revision });
      } catch { valid = false; sourceStates.push({ sourceId, state: "RECHECK_REQUIRED" }); }
    }
    const effectiveStatus = valid ? claim.statusProjection : "EXPIRED";
    const validityHash = jsonHash({ id: claim.id, revision: claim.currentRevision, effectiveStatus, restricted, sourceStates,
      intentHash: current.intentHash, reusePolicyHash: current.reusePolicyHash, reuseAllowed });
    items.push({ id: claim.id, revision: claim.currentRevision, statement: restricted ? "原判断涉及当前不可访问的资料" : claim.canonicalStatement,
      conditions: restricted ? [] : claim.conditionsJson as string[], effectiveStatus: restricted ? "RESTRICTED" : effectiveStatus,
      recordedStatus: claim.statusProjection, explanation: restricted ? null : event?.modelInterpretation ?? null,
      nextInformationNeed: restricted ? null : assessment.nextInformationNeed as string ?? null,
      qualificationReason: restricted ? null : assessment.qualificationReason as string ?? null,
      evidence: restricted ? [] : evidence.map(e => ({ sourceId: e.sourceId, projectId: e.projectId, role: e.role, quote: e.quote, qualified: valid && e.qualified === true })),
      history: restricted ? [] : history.slice(0,8).map(e => ({ revision: e.revision, at: e.createdAt.toISOString(),
        statement: record(e.assessmentJson).statement as string, state: record(e.assessmentJson).effectiveState as string })),
      sourceMissionId: typeof root.missionId === "string" && !restricted ? root.missionId : null,
      sourceConversationId: typeof root.conversationId === "string" && !restricted ? root.conversationId : null,
      scopeProjectIds: dependencyProjects, validUntil: event?.validUntil?.toISOString() ?? null, validityHash, reuseAllowed: reuseAllowed && !restricted,
      authority: "CONDITIONAL_MODEL_ASSESSMENT_NOT_FACT_VERIFICATION" });
  }
  return { items, coverage: { hasMore: claims.length > 16 } };
}

/** Conditional model judgments are a separate context facet, never forged into original evidence. */
export async function composeHypotheses(userId: string, projectId: string, allowedProjectIds = [projectId], tx: Tx = db) {
  const view = await readHypotheses(userId, projectId, tx);
  const candidates = view.items.filter(i => i.reuseAllowed && i.effectiveStatus !== "RESTRICTED" && i.scopeProjectIds.every(p => allowedProjectIds.includes(p)));
  const items = candidates.slice(0, 4);
  return { items, readSet: items.map(i => ({ claimId: i.id, projectId, revision: i.revision, validityHash: i.validityHash })),
    coverage: { complete: !view.coverage.hasMore && items.length === candidates.length },
    policy: "条件推测及其版本，不是事实或授权；EXPIRED须重新调查，SUPPORTED仍须回到原证据；发现反例时更新同一claimId与expectedRevision。" };
}

export async function assertCognitiveReadSet(userId: string, raw: unknown, tx: Tx = db) {
  if (!Array.isArray(raw)) return;
  if (raw.length > 16) throw new AppError("COGNITIVE_RECOORDINATE", "认知读集超出范围，请重新核对", 409);
  for (const value of raw) {
    const ref = record(value);
    if (typeof ref.claimId !== "string" || typeof ref.projectId !== "string") throw new AppError("COGNITIVE_RECOORDINATE", "原认知绑定不完整", 409);
    const state = (await readHypotheses(userId, ref.projectId, tx, [ref.claimId])).items[0];
    if (!state || state.revision !== ref.revision || state.validityHash !== ref.validityHash) throw new AppError("COGNITIVE_RECOORDINATE", "判断或依据已变化，正在重新协调", 409);
  }
}
