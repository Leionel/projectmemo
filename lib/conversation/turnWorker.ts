import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { executeAcceptedConversationTurn } from "./turnService";
import { newTurnLease, withTurnLease, heartbeatTurn } from "./turnRuntime";
import { record } from "./repository";
import { json } from "@/lib/mission/contracts";

const TURN_SCAN_PAGE = 30;

/** Schedules the original ConversationTurn executor; no second research task or business Runner. */
export async function runConversationTurn(options: { onClaim?: () => void } = {}) {
  if (!isFeatureEnabled("FOCUS_ASYNC_ENABLED", isFeatureEnabled("FOCUS_WEB_ENABLED", false))) return false;
  // 同步 turn 崩溃后也会留在这些状态里；逐页向后找，遗留记录不能占满窗口饿死待执行的 turn。
  let next;
  for (let skip = 0; !next && skip < 3000; skip += TURN_SCAN_PAGE) {
    const page = await db.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, sessionId: { not: null },
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: new Date() } }] }, orderBy: { createdAt: "asc" }, skip, take: TURN_SCAN_PAGE, include: { conversation: true } });
    next = page.find(t => record(t.readManifestJson).deferred === true);
    if (page.length < TURN_SCAN_PAGE) break;
  }
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
  options.onClaim?.();
  const heartbeat = setInterval(() => { void withTurnLease(next.id, token, () => heartbeatTurn(next.id)).catch(() => undefined); }, 5000);
  try {
    const turn = await db.conversationTurn.findUniqueOrThrow({ where: { id: next.id } });
    await withTurnLease(next.id, token, () => executeAcceptedConversationTurn({ userId: next.conversation.ownerUserId, sessionId: next.sessionId! }, next.conversationId, turn));
  } catch { /* Original executor records failure/unknown. A lost fence cannot mutate the replacement worker. */ }
  finally { clearInterval(heartbeat); await db.conversationTurn.updateMany({ where: { id: next.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null } }); }
  return true;
}
