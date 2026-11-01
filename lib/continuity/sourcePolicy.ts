import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record, type Tx } from "@/lib/conversation/repository";
import { effectiveContinuity } from "./directiveService";
import { isFeatureEnabled } from "@/lib/config/features";
import { repositoryGrantCurrent } from "@/lib/sensing/repoGrantBinding";

export type SourceUse = { state: "ALLOWED" | "SUPPRESSED" | "UNKNOWN"; roots: string[]; independentEvidence: boolean; reason: string };
/** Follow original roots, not copies of conclusions. Cycles, missing manifests and cross-project edges stay unknown. */
export async function sourceLineage(projectId: string, id: string, tx: Tx = db, seen = new Set<string>(), budget = { remaining: 64 }): Promise<{ roots: string[]; known: boolean; derived: boolean; blocked?: boolean;blockedReason?:string }> {
  if (typeof id !== "string" || !id) return { roots: [], known: false, derived: true };
  if (seen.has(id) || seen.size >= 32 || budget.remaining-- <= 0) return { roots: [], known: false, derived: true };
  const next = new Set(seen).add(id), childIds: string[] = [];
  let known = true, derived = false, blocked = false;
  let blockedReason:string|undefined;
  if (id.startsWith("claim:")) {
    const claim = await tx.agentClaim.findFirst({ where: { id: id.slice(6), projectId, scopeType: "PROJECT" } });
    const origin = record(claim?.originJson);
    const prefixes: Record<string, string> = { CLAIM: "claim:", CAPTURE: "capture:", CARD: "card:", ARTIFACT: "artifact:", EPISODE: "episode:", MESSAGE: "message:", MISSION_OUTPUT: "mission-output:" };
    if (claim?.kind === "HYPOTHESIS") {
      childIds.push("claim-origin:" + claim.id);
      const event = await tx.agentClaimEvent.findUnique({ where: { claimId_revision: { claimId: claim.id, revision: claim.currentRevision } } });
      for (const raw of Array.isArray(event?.evidenceManifestJson) ? event.evidenceManifestJson : []) {
        const entry = record(raw);
        if (entry.projectId === projectId && typeof entry.sourceId === "string") childIds.push(entry.sourceId);
        else known = false;
      }
    } else if (claim && typeof origin.kind === "string" && prefixes[origin.kind] && typeof origin.id === "string") childIds.push(prefixes[origin.kind] + origin.id);
    else known = false;
    derived = true;
  } else if (id.startsWith("claim-origin:")) {
    const claim = await tx.agentClaim.findFirst({ where: { id: id.slice(13), projectId, scopeType: "PROJECT" } });
    const origin = record(claim?.originJson);
    if (origin.kind === "MISSION_OUTPUT") known = !!await tx.agentMissionOutput.findFirst({ where: { id: String(origin.id), mission: { projectId, ownerUserId: claim?.ownerUserId,
      project: { memberships: { some: { userId: claim?.ownerUserId, role: "OWNER" } } } } } });
    else if (origin.kind === "MESSAGE" && claim) {
      const privacy = await (await import("@/lib/memory/conversationDigest")).validateConversationDigest(tx, claim.ownerUserId, projectId, String(origin.conversationId), { id: origin.id }, []);
      known = !privacy.restricted;
    }
    else known = false;
    derived = true; // Known model authorship is never independent evidence.
  } else if (id.startsWith("episode:")) {
    const revision = await tx.episodeRevision.findFirst({ where: { id: id.slice(8), episode: { projectId } } });
    if (!revision || !Array.isArray(revision.sourceRefs) || !revision.sourceRefs.length) known = false;
    else for (const raw of revision.sourceRefs) {
      const ref = record(raw);
      if (typeof ref.entityId !== "string") { known = false; continue; }
      if (ref.kind === "CARD" || ref.kind === "ACTION_RESULT") childIds.push("card:" + ref.entityId);
      else if (ref.kind === "RELATION") {
        const relation = await tx.cardRelation.findFirst({ where: { id: ref.entityId, currentCard: { projectId }, relatedCard: { projectId } } });
        if (relation) childIds.push("card:" + relation.currentCardId, "card:" + relation.relatedCardId); else known = false;
      } else if (ref.kind === "ATTACHMENT_REVISION") {
        const attachment = await tx.attachmentRevision.findFirst({ where: { id: ref.entityId, attachment: { projectId } } });
        if (attachment) childIds.push("attachment:" + attachment.attachmentId); else known = false;
      } else known = false; // A snapshot without a leaf manifest is not independent evidence.
    }
    derived = true;
  } else if (id.startsWith("message:") || id.startsWith("mission-output:")) {
    let manifest: unknown;
    if (id.startsWith("message:")) {
      const message = await tx.agentMessage.findFirst({ where: { id: id.slice(8), OR: [{ projectId }, { conversation: { homeProjectId: projectId } }] } });
      manifest = record(message?.blocksJson).sources;
    } else {
      const output = await tx.agentMissionOutput.findFirst({ where: { id: id.slice(15), mission: { projectId } } });
      manifest = output?.sourceRefsJson;
    }
    if (!Array.isArray(manifest) || !manifest.length) known = false;
    else for (const raw of manifest) {
      const ref = record(raw), sourceId = ref.sourceId ?? ref.id;
      if (ref.projectId && ref.projectId !== projectId || typeof sourceId !== "string") known = false;
      else childIds.push(sourceId);
    }
    derived = true;
  } else if (id.startsWith("card:")) {
    const card = await tx.knowledgeCard.findFirst({ where: { id: id.slice(5), projectId } });
    if (!card) return { roots: [], known: false, derived: true };
    childIds.push("capture:" + card.captureId); if (card.attachmentId) childIds.push("attachment:" + card.attachmentId);
    const links = await tx.cardRelation.findMany({ where: { currentCardId: card.id, relationType: "DERIVED_FROM" } });
    // Even unconfirmed derivation is a taint edge, never a proof of support.
    childIds.push(...links.map(l => "card:" + l.relatedCardId)); derived = true;
  } else if (id.startsWith("artifact:")) {
    const a = await tx.generatedArtifact.findFirst({ where: { id: id.slice(9), projectId }, include: { missionReceipt: true } });
    if (!a) return { roots: [], known: false, derived: true };
    const manifest = a.missionReceipt?.sourceManifestJson ?? record(a.sourceRefs).sources ?? a.sourceRefs;
    if (Array.isArray(manifest)) for (const raw of manifest) {
      const s = record(raw); if (s.projectId && s.projectId !== projectId) { known = false; continue; }
      const sourceId = typeof s.sourceId === "string" ? s.sourceId : typeof s.id === "string" ? s.id : typeof s.cardId === "string" ? "card:" + s.cardId : null;
      if (sourceId) childIds.push(sourceId); else known = false;
    } else known = false;
    if (!childIds.length) known = false; derived = true;
  } else if (id.startsWith("experience:")) {
    const e = await tx.agentExperience.findFirst({ where: { id: id.slice(11), projectId } });
    if (!e) return { roots: [], known: false, derived: true };
    const rawIds = e.sampleMissionIdsJson;
    const missionIds = Array.isArray(rawIds) ? rawIds.filter((v): v is string => typeof v === "string").slice(0, 64) : [];
    const missions = await tx.agentMission.findMany({ where: { id: { in: missionIds }, projectId }, select: { id: true } });
    const steps = await tx.agentMissionStep.findMany({ where: { missionId: { in: missionIds }, mission: { projectId } }, select: { missionId: true, resultJson: true } });
    for (const step of steps) for (const s of (record(step.resultJson).sources ?? []) as Array<{ id: string }>) childIds.push(s.id);
    known = Array.isArray(rawIds) && rawIds.length === missionIds.length && missions.length === new Set(missionIds).size &&
      missionIds.length > 0 && missionIds.every(id => steps.some(s => s.missionId === id && Array.isArray(record(s.resultJson).sources) && (record(s.resultJson).sources as unknown[]).length > 0)); derived = true;
  } else if(id.startsWith("doc:")){
    const observationsModule=await import("@/lib/documents/observations"),source=await observationsModule.findDocumentObservation(projectId,id,tx);
    if(source?.document){childIds.push("attachment:"+source.document.attachmentId);blocked=!await observationsModule.documentObservationCurrent(projectId,source,tx);if(blocked)blockedReason=isFeatureEnabled("DOCUMENT_DEEP_READ_ENABLED",false)?"DOCUMENT_VERSION_CHANGED":"DOCUMENT_READER_DISABLED";}else known=false;
    derived=true;
  } else if (id.startsWith("connection:")) {
    const c=await tx.sourceConnection.findFirst({where:{id:id.slice(11),projectId,provider:"DEPLOYMENT"}});
    known=Boolean(c);
    if(c){try{await(await import("@/lib/sensing/deploymentConnections")).deploymentConnection(c.ownerUserId,projectId,c.id,tx);}catch(error){if(!(error instanceof AppError))throw error;blocked=true;blockedReason=error.code;}}
  } else if (id.startsWith("deploy:")) {
    const observations=await import("@/lib/sensing/deploymentObservations"),source=await observations.findDeploymentObservation(projectId,id,tx);
    if(source?.deployment){childIds.push("connection:"+source.deployment.connectionId);blocked=!await observations.deploymentObservationCurrent(projectId,source,tx);if(blocked)blockedReason="DEPLOYMENT_OBSERVATION_STALE";}else known=false;
    derived=true;
  } else if (id.startsWith("ci:")) {
    const source = await (await import("@/lib/sensing/repoCiObservations")).findRepositoryObservation(projectId, id, tx);
    if (source?.repository) {
      const r = source.repository; childIds.push("repo:" + r.connectionId);
      const c = await tx.sourceConnection.findFirst({ where: { id: r.connectionId, projectId, status: "ACTIVE", revokedAt: null, revision: r.connectionRevision } });
      blocked = !c || !["COMMITS_AND_CI", "COMMITS_CI_LOGS"].includes(c.signalKind) || r.kind === "LOG" && c.signalKind !== "COMMITS_CI_LOGS";
    } else known = false;
    derived = true;
  } else if (id.startsWith("capture:")) {
    const capture = await tx.capture.findFirst({ where: { id: id.slice(8), projectId }, select: { id: true, sourceType: true } });
    known = !!capture;
    const signals = await tx.externalSignal.findMany({ where: { adoptedCaptureId: id.slice(8), projectId }, select: { id: true } });
    childIds.push(...signals.map(s => "signal:" + s.id));
    if (signals.length || capture?.sourceType === "仓库信号") { derived = true; known &&= signals.length > 0; }
  } else if (id.startsWith("signal:")) {
    const signal = await tx.externalSignal.findFirst({ where: { id: id.slice(7), projectId }, include: { connection: true } });
    known = !!signal;
    if (signal) {
      childIds.push("repo:" + signal.connectionId); derived = true;
      if (signal.connection.projectId !== projectId || signal.connection.ownerUserId !== signal.ownerUserId) known = false;
      if (!repositoryGrantCurrent(signal.sourceBindingJson, signal.connection)) {
        blocked = signal.connection.status !== "ACTIVE" || signal.connection.revokedAt !== null;
        if (!blocked) known = false;
        else blockedReason = "SOURCE_PERMISSION_REVOKED";
      }
    }
  }
  else if (id.startsWith("attachment:")) known = !!await tx.attachment.findFirst({ where: { id: id.slice(11), projectId }, select: { id: true } });
  else if (id.startsWith("action:")) {
    const a = await tx.actionItem.findFirst({ where: { id: id.slice(7), projectId } }); known = !!a;
    if (a?.sourceCardId) childIds.push("card:" + a.sourceCardId);
    if (a?.resultCardId) childIds.push("card:" + a.resultCardId);
  } else if (id.startsWith("mission:")) known = !!await tx.agentMission.findFirst({ where: { id: id.slice(8), projectId } });
  else if (id.startsWith("web:")) {
    const matches = await tx.$queryRaw<Array<{ value: string;currentScopeVersion:number }>>`
      SELECT s.value,c."researchScopeVersion" as currentScopeVersion FROM "ConversationTurn" t JOIN "Conversation" c ON c.id=t."conversationId", json_each(t."readManifestJson", '$.webSources') s
      WHERE json_extract(s.value, '$.sourceId') = ${id} AND json_extract(s.value, '$.projectId') = ${projectId} LIMIT 1`;
    const source = matches[0] ? record(JSON.parse(matches[0].value)) : {};
    if(matches[0]&&record(source.external).scopeRevision!==matches[0].currentScopeVersion){blocked=true;blockedReason="SOURCE_SCOPE_CHANGED";}
    const parents=record(source.external).provenanceSourceIds;
    if(Array.isArray(parents)){for(const parent of parents.slice(0,4))if(typeof parent==="string")childIds.push(parent);else known=false;derived=true;}
    const url = record(source.external).requestedUrl;
    if (typeof url === "string") { const canonical = new URL(url); canonical.hash = ""; childIds.push("url:" + canonical.href); }
    else known = false;
  } else if (id.startsWith("url:")) {
    // This edge is obtained from an original adapter's persisted observation.
  } else if (id.startsWith("calendar:")) {
    const observation = await tx.calendarObservation.findFirst({ where: { id: id.slice(9), projectId }, include: { connection: true } });
    known = !!observation;
    if (observation) {
      derived = true;
      const connection = observation.connection;
      if (connection.projectId !== projectId || connection.ownerUserId !== observation.ownerUserId) known = false;
      else if (connection.status !== "ACTIVE" || connection.revokedAt !== null || connection.authGeneration !== Number(record(observation.payloadJson).authGeneration)) {
        blocked = true; blockedReason = "SOURCE_PERMISSION_REVOKED";
      } else if (+observation.observedAt+15*60*1000<=Date.now()) {
        blocked=true;blockedReason="CALENDAR_OBSERVATION_STALE";
      } else if (connection.calendarId !== observation.calendarId) {
        blocked = true; blockedReason = "SOURCE_SCOPE_CHANGED";
      }
      if (!blocked) {
        const newer = await tx.calendarObservation.findFirst({
          where: { connectionId: observation.connectionId, eventId: observation.eventId, observedAt: { gt: observation.observedAt } },
          orderBy: { observedAt: "desc" },
        });
        if (newer && newer.revision !== observation.revision) { blocked = true; blockedReason = "SOURCE_REVISION_CHANGED"; }
      }
    }
  } else if (id.startsWith("repo:") || id === "project:" + projectId) {
    // Identity/revision/grant are checked by the original adapter; these are original observations, never user authority.
  } else {
    const external = await tx.externalSource.findFirst({ where: { id, mission: { projectId } }, select: { id: true,requestedUrl:true,excerptJson:true,retrievalMode:true,mission:{select:{researchScopeVersion:true}} } }); known = !!external;
    if(external?.retrievalMode==="ACADEMIC_METADATA"&&record(external.excerptJson).scopeRevision!==external.mission.researchScopeVersion){blocked=true;blockedReason="SOURCE_SCOPE_CHANGED";}
    if(external){childIds.push("url:"+external.requestedUrl);const parents=record(external.excerptJson).parentSourceIds;if(Array.isArray(parents)){for(const parent of parents.slice(0,4))if(typeof parent==="string")childIds.push(parent);else known=false;derived=true;}}
  }
  const roots = [id];
  for (const child of new Set(childIds)) { const line = await sourceLineage(projectId, child, tx, next, budget); roots.push(...line.roots); known &&= line.known; blocked ||= line.blocked === true;blockedReason??=line.blockedReason; }
  return { roots: [...new Set(roots)], known, derived, blocked,blockedReason };
}
export async function sourceUse(userId: string, projectId: string, sourceId: string, tx: Tx = db, scope?: { conversationId?: string; missionId?: string }): Promise<SourceUse> {
  const view = await effectiveContinuity(userId, { projectId, ...scope }, tx);
  const suppressed = new Set(view.directives.filter(d => d.kind === "USE_SUPPRESSION").flatMap(d => d.sourceIds));
  const line = await sourceLineage(projectId, sourceId, tx);
  const connectionIds=line.roots.filter(r=>r.startsWith("connection:")).map(r=>r.slice(11));
  if(connectionIds.length&&await tx.sourceConnection.count({where:{id:{in:connectionIds},projectId,ownerUserId:{not:userId}}}))return{state:"UNKNOWN",roots:[],independentEvidence:false,reason:"PRIVATE_CONNECTION"};
  const claimIds = line.roots.filter(r => r.startsWith("claim:") || r.startsWith("claim-origin:")).map(r => r.slice(r.startsWith("claim:") ? 6 : 13));
  if (claimIds.length && await tx.agentClaim.count({ where: { id: { in: claimIds }, ownerUserId: { not: userId } } }))
    return { state: "UNKNOWN", roots: [], independentEvidence: false, reason: "PRIVATE_CLAIM" };
  if (line.blocked) return { state: "SUPPRESSED", roots: line.roots, independentEvidence: false, reason: line.blockedReason??"SOURCE_PERMISSION_REVOKED" };
  if (line.roots.some(r => suppressed.has(r))) return { state: "SUPPRESSED", roots: line.roots, independentEvidence: false, reason: "ROOT_SUPPRESSED" };
  if (!line.known) return { state: "UNKNOWN", roots: line.roots, independentEvidence: false, reason: "LINEAGE_UNKNOWN" };
  return { state: "ALLOWED", roots: line.roots, independentEvidence: !line.derived, reason: line.derived ? "DERIVED_REFERENCE" : "ORIGINAL_OBSERVATION" };
}
export async function assertSourceUse(userId: string, projectId: string, sourceId: string, tx: Tx = db, scope?: { conversationId?: string; missionId?: string }) {
  const policy = await sourceUse(userId, projectId, sourceId, tx, scope);
  if(policy.reason==="DEPLOYMENT_OBSERVATION_STALE")throw new AppError("DEPLOYMENT_OBSERVATION_STALE","原环境观察已过期或许可变化，请重新核对",409);
  if(policy.reason==="SOURCE_SCOPE_CHANGED")throw new AppError("SCOPE_CHANGED","原研究授权已变化，请重新核对范围和来源",409);
  if(policy.reason==="DOCUMENT_VERSION_CHANGED")throw new AppError("SOURCE_CHANGED","原文件或文本修订已变化，请重新读取后继续",409);
  if(policy.reason==="DOCUMENT_READER_DISABLED")throw new AppError("DOCUMENT_READER_DISABLED","文档深读当前已关闭，原观察保留为历史",503);
  if (policy.state !== "ALLOWED") throw new AppError(policy.state === "SUPPRESSED" ? "SOURCE_USE_SUPPRESSED" : "SOURCE_LINEAGE_UNKNOWN",
    policy.state === "SUPPRESSED" ? "你已要求停止使用这条资料及其派生结论，请重新调查" : "这条结论的原始来源尚不明确，请读取原始资料后继续", 409);
  return policy;
}
