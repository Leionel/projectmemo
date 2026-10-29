import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record, type Tx } from "@/lib/conversation/repository";
import { effectiveContinuity } from "./directiveService";

export type SourceUse = { state: "ALLOWED" | "SUPPRESSED" | "UNKNOWN"; roots: string[]; independentEvidence: boolean; reason: string };
/** Follow original roots, not copies of conclusions. Cycles, missing manifests and cross-project edges stay unknown. */
export async function sourceLineage(projectId: string, id: string, tx: Tx = db, seen = new Set<string>(), budget = { remaining: 64 }): Promise<{ roots: string[]; known: boolean; derived: boolean; blocked?: boolean }> {
  if (typeof id !== "string" || !id) return { roots: [], known: false, derived: true };
  if (seen.has(id) || seen.size >= 32 || budget.remaining-- <= 0) return { roots: [], known: false, derived: true };
  const next = new Set(seen).add(id), childIds: string[] = [];
  let known = true, derived = false, blocked = false;
  if (id.startsWith("card:")) {
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
  } else if (id.startsWith("ci:")) {
    const source = await (await import("@/lib/sensing/repoCiObservations")).findRepositoryObservation(projectId, id, tx);
    if (source?.repository) {
      const r = source.repository; childIds.push("repo:" + r.connectionId);
      const c = await tx.sourceConnection.findFirst({ where: { id: r.connectionId, projectId, status: "ACTIVE", revokedAt: null, revision: r.connectionRevision } });
      blocked = !c || !["COMMITS_AND_CI", "COMMITS_CI_LOGS"].includes(c.signalKind) || r.kind === "LOG" && c.signalKind !== "COMMITS_CI_LOGS";
    } else known = false;
    derived = true;
  } else if (id.startsWith("capture:")) known = !!await tx.capture.findFirst({ where: { id: id.slice(8), projectId }, select: { id: true } });
  else if (id.startsWith("attachment:")) known = !!await tx.attachment.findFirst({ where: { id: id.slice(11), projectId }, select: { id: true } });
  else if (id.startsWith("action:")) {
    const a = await tx.actionItem.findFirst({ where: { id: id.slice(7), projectId } }); known = !!a;
    if (a?.sourceCardId) childIds.push("card:" + a.sourceCardId);
    if (a?.resultCardId) childIds.push("card:" + a.resultCardId);
  } else if (id.startsWith("mission:")) known = !!await tx.agentMission.findFirst({ where: { id: id.slice(8), projectId } });
  else if (id.startsWith("web:")) {
    const matches = await tx.$queryRaw<Array<{ value: string }>>`
      SELECT s.value FROM "ConversationTurn" t, json_each(t."readManifestJson", '$.webSources') s
      WHERE json_extract(s.value, '$.sourceId') = ${id} AND json_extract(s.value, '$.projectId') = ${projectId} LIMIT 1`;
    const source = matches[0] ? record(JSON.parse(matches[0].value)) : {};
    const url = record(source.external).requestedUrl;
    if (typeof url === "string") { const canonical = new URL(url); canonical.hash = ""; childIds.push("url:" + canonical.href); }
    else known = false;
  } else if (id.startsWith("url:")) {
    // This edge is obtained from an original adapter's persisted observation.
  } else if (id.startsWith("repo:") || id === "project:" + projectId) {
    // Identity/revision/grant are checked by the original adapter; these are original observations, never user authority.
  } else {
    const external = await tx.externalSource.findFirst({ where: { id, mission: { projectId } }, select: { id: true } }); known = !!external;
  }
  const roots = [id];
  for (const child of new Set(childIds)) { const line = await sourceLineage(projectId, child, tx, next, budget); roots.push(...line.roots); known &&= line.known; blocked ||= line.blocked === true; }
  return { roots: [...new Set(roots)], known, derived, blocked };
}
export async function sourceUse(userId: string, projectId: string, sourceId: string, tx: Tx = db, scope?: { conversationId?: string; missionId?: string }): Promise<SourceUse> {
  const view = await effectiveContinuity(userId, { projectId, ...scope }, tx);
  const suppressed = new Set(view.directives.filter(d => d.kind === "USE_SUPPRESSION").flatMap(d => d.sourceIds));
  const line = await sourceLineage(projectId, sourceId, tx);
  if (line.blocked) return { state: "SUPPRESSED", roots: line.roots, independentEvidence: false, reason: "SOURCE_PERMISSION_REVOKED" };
  if (line.roots.some(r => suppressed.has(r))) return { state: "SUPPRESSED", roots: line.roots, independentEvidence: false, reason: "ROOT_SUPPRESSED" };
  if (!line.known) return { state: "UNKNOWN", roots: line.roots, independentEvidence: false, reason: "LINEAGE_UNKNOWN" };
  return { state: "ALLOWED", roots: line.roots, independentEvidence: !line.derived, reason: line.derived ? "DERIVED_REFERENCE" : "ORIGINAL_OBSERVATION" };
}
export async function assertSourceUse(userId: string, projectId: string, sourceId: string, tx: Tx = db, scope?: { conversationId?: string; missionId?: string }) {
  const policy = await sourceUse(userId, projectId, sourceId, tx, scope);
  if (policy.state !== "ALLOWED") throw new AppError(policy.state === "SUPPRESSED" ? "SOURCE_USE_SUPPRESSED" : "SOURCE_LINEAGE_UNKNOWN",
    policy.state === "SUPPRESSED" ? "你已要求停止使用这条资料及其派生结论，请重新调查" : "这条结论的原始来源尚不明确，请读取原始资料后继续", 409);
  return policy;
}
