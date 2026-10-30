import { db } from "@/lib/db";
import type { Tx } from "@/lib/conversation/repository";
import type { DirectiveScope } from "@/lib/types/continuity";

/** No directiveService import: effective cognition is consumed by the original continuity clock. */
export async function claimControlState(userId: string, scope: DirectiveScope, tx: Tx = db, now = new Date()) {
  const events = await tx.agentClaimEvent.findMany({ where: { ownerUserId: userId, controlSeq: { not: null }, claim: {
    ownerUserId: userId, projectId: scope.projectId,
    AND: [{ OR: [{ conversationId: null }, ...(scope.conversationId ? [{ conversationId: scope.conversationId }] : [])] },
      { OR: [{ missionId: null }, ...(scope.missionId ? [{ missionId: scope.missionId }] : [])] }],
  } }, orderBy: { controlSeq: "asc" }, include: { claim: true } });
  const heads = new Map<string, typeof events[number]>();
  for (const e of events) if (+e.validFrom <= +now) heads.set(e.claimId, e);
  const active = [...heads.values()].filter(e => e.eventKind === "USER_CORRECTION" && (!e.validUntil || +now < +e.validUntil));
  const boundaries = events.flatMap(e => [e.validFrom, e.validUntil]).filter((d): d is Date => !!d && +d > +now).sort((a,b) => +a-+b);
  return { epoch: events.map(e => ({ id: e.id, seq: e.controlSeq, segment: +now < +e.validFrom ? "BEFORE" : e.validUntil && +now >= +e.validUntil ? "AFTER" : "ACTIVE" })),
    corrections: active.map(e => ({ claimId: e.claimId, revision: e.revision, statement: e.claim.canonicalStatement,
      userCorrection: e.userQuote, origin: e.claim.originJson, validUntil: e.validUntil?.toISOString() ?? null, authority: "USER_INTERPRETATION" as const })),
    nextBoundary: boundaries[0] ?? null };
}
