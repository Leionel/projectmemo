import { db } from "@/lib/db";
import { record, type Tx } from "@/lib/conversation/repository";
import { readHypotheses } from "./hypothesisService";

const maxClaimDepth = 2;
/** Text exposure follows the original reader's permissions, not ownership of the correction record. */
async function claimTextReadable(userId: string, projectId: string, claim: { id: string; kind: string; originJson: unknown }, tx: Tx, depth: number) {
  if (claim.kind === "HYPOTHESIS") {
    const item = (await readHypotheses(userId, projectId, tx, [claim.id])).items[0];
    return !!item && item.effectiveStatus !== "RESTRICTED";
  }
  if (depth >= maxClaimDepth) return false;
  const origin = record(claim.originJson);
  if (typeof origin.kind !== "string" || typeof origin.id !== "string") return false;
  return await readClaimSourceText(userId, projectId, origin.kind, origin.id, tx, depth + 1) !== undefined;
}

export async function readClaimSourceText(userId: string, projectId: string, kind: string, id: string, tx: Tx = db, depth = 0): Promise<string | undefined> {
  if (kind === "CLAIM") {
    const claim = await tx.agentClaim.findFirst({ where: { id, projectId, ownerUserId: userId, scopeType: "PROJECT" } });
    if (!claim || !await claimTextReadable(userId, projectId, claim, tx, depth)) return undefined;
    return claim.canonicalStatement;
  }
  if (kind === "CAPTURE") return (await tx.capture.findFirst({ where: { id, projectId } }))?.rawText;
  if (kind === "CARD") { const c = await tx.knowledgeCard.findFirst({ where: { id, projectId } }); return c ? c.title + "\n" + c.summary : undefined; }
  if (kind === "ARTIFACT") return (await tx.generatedArtifact.findFirst({ where: { id, projectId } }))?.content;
  if (kind === "EPISODE") { const e = await tx.episodeRevision.findFirst({ where: { id, episode: { projectId } } }); return e ? JSON.stringify(e.summary) : undefined; }
  if (kind === "MISSION_OUTPUT") {
    const output = await tx.agentMissionOutput.findFirst({ where: { id, mission: { projectId, ownerUserId: userId,
      project: { memberships: { some: { userId, role: "OWNER" } } } } } });
    return output ? JSON.stringify(output.contentJson) : undefined;
  }
  if (kind === "MESSAGE") {
    const message = await tx.agentMessage.findFirst({ where: { id, OR: [{ ownerUserId: userId }, { conversation: { ownerUserId: userId } }] },
      include: { conversation: { select: { ownerUserId: true, homeProjectId: true, projects: { select: { projectId: true } } } } } });
    if (!message || message.conversation && message.conversation.ownerUserId !== userId) return undefined;
    const conversation = message.conversation;
    const linked = message.projectId === projectId || conversation?.homeProjectId === projectId ||
      conversation?.projects.some(p => p.projectId === projectId);
    if (!linked) return undefined;
    const observed = record(message.blocksJson).observedProjectIds;
    const required = [...new Set([message.projectId, conversation?.homeProjectId,
      ...(Array.isArray(observed) ? observed.filter((p): p is string => typeof p === "string") : [])].filter((p): p is string => !!p))];
    if (required.length) {
      const members = await tx.projectMembership.findMany({ where: { userId, projectId: { in: required } }, select: { projectId: true } });
      if (members.length !== required.length) return undefined;
    }
    return message.content;
  }
  return undefined;
}
