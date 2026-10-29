import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { executeAcceptedConversationTurn } from "./turnService";
import { newTurnLease, withTurnLease, heartbeatTurn } from "./turnRuntime";
import { record } from "./repository";
import { json } from "@/lib/mission/contracts";

/** Schedules the original ConversationTurn executor; no second research task or business Runner. */
export async function runConversationTurn() {
  if (!isFeatureEnabled("FOCUS_ASYNC_ENABLED", isFeatureEnabled("FOCUS_WEB_ENABLED", false))) return false;
  const pending = await db.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, sessionId: { not: null },
    OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: "asc" }, take: 30, include: { conversation: true } });
  const next = pending.find(t => record(t.readManifestJson).deferred === true);
  if (!next) return false;
  const token = newTurnLease();
  const startedAt = new Date().toISOString(); let accumulated = 0;
  const claim = await db.$transaction(async tx => {
    const claimed = await tx.conversationTurn.updateMany({ where: { id: next.id, status: next.status, leaseToken: next.leaseToken,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 30000) } });
    if (!claimed.count) return claimed;
    const current = await tx.conversationTurn.findUniqueOrThrow({ where: { id: next.id } }), manifest = record(current.readManifestJson);
    accumulated = Number(manifest.runtimeActiveCheckpointMs ?? manifest.runtimeAccumulatedMs ?? 0) + (next.leaseToken ? 5000 : 0);
    await tx.conversationTurn.update({ where: { id: next.id }, data: { readManifestJson: json({ ...manifest, runtimeAccumulatedMs: accumulated, runtimeActiveCheckpointMs: accumulated, runtimeStartedAt: startedAt }) } });
    return claimed;
  });
  if (!claim.count) return true;
  const heartbeat = setInterval(() => { void withTurnLease(next.id, token, () => heartbeatTurn(next.id)).catch(() => undefined); }, 5000);
  try {
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: next.id } });
    await withTurnLease(next.id, token, () => executeAcceptedConversationTurn({ userId: next.conversation.ownerUserId, sessionId: next.sessionId! }, next.conversationId, turn));
  } catch { /* Original executor records failure/unknown. A lost fence cannot mutate the replacement worker. */ }
  finally { clearInterval(heartbeat); await db.conversationTurn.updateMany({ where: { id: next.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } }); }
  return true;
}
