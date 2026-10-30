import { db } from "@/lib/db";
const claimId = process.argv[2]!;
const events = await db.agentClaimEvent.findMany({ where: { claimId }, select: { revision: true, eventKind: true, userQuote: true, controlSeq: true } });
const user = await db.user.findFirst({ where: { username: "ux2-acceptance" }, select: { continuitySeq: true } });
const claim = await db.agentClaim.findUniqueOrThrow({ where: { id: claimId }, select: { currentRevision: true } });
console.log(JSON.stringify({ events, claim, continuitySeq: user?.continuitySeq }));
await db.$disconnect();
