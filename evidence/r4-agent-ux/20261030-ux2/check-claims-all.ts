import { db } from "@/lib/db";
const claims = await db.agentClaim.findMany({ select: { id: true, kind: true, originKey: true, canonicalStatement: true, currentRevision: true, conversationId: true, scopeKey: true } });
const events = await db.agentClaimEvent.findMany({ where: { controlSeq: { not: null } }, select: { claimId: true, revision: true, eventKind: true, userQuote: true, controlSeq: true, targetHash: true } });
console.log(JSON.stringify({ claims, controlEvents: events }, null, 1));
await db.$disconnect();
