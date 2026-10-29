import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import type { Prisma } from "@/lib/generated/prisma/client";
import type { ConversationActor, ConversationBlocks } from "@/lib/types/conversation";

export type Tx = Prisma.TransactionClient;
export const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function requireConversations() {
  if (!isFeatureEnabled("FOCUS_AGENT_ENABLED", false)) throw new AppError("FOCUS_AGENT_DISABLED", "全局协作暂未开启", 503);
}
export async function assertSession(actor: ConversationActor, tx: Tx = db) {
  requireConversations();
  if (!await tx.authSession.findFirst({ where: {
    id: actor.sessionId, userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() },
  } })) throw new AppError("UNAUTHORIZED", "登录状态已失效，请重新登录", 401);
}
export async function assertProject(actor: ConversationActor, projectId: string, tx: Tx = db) {
  await assertSession(actor, tx);
  const member = await tx.projectMembership.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId } } });
  if (!member) throw new AppError("PROJECT_NOT_FOUND", "项目不存在或无法访问", 404);
  return member;
}
export async function ownedConversation(actor: ConversationActor, id: string, tx: Tx = db) {
  await assertSession(actor, tx);
  const row = await tx.conversation.findFirst({ where: { id, ownerUserId: actor.userId } });
  if (!row) throw new AppError("CONVERSATION_NOT_FOUND", "讨论不存在或无法访问", 404);
  if (row.homeProjectId) await assertProject(actor, row.homeProjectId, tx);
  return row;
}
/** Acquire the SQLite write slot before inspecting an idempotency record. */
export async function lockConversation(tx: Tx, id: string) {
  await tx.conversation.updateMany({ where: { id }, data: { version: { increment: 0 } } });
}
export const emptyBlocks = (): ConversationBlocks => ({
  schemaVersion: 1, refs: [], sources: [], priorities: [], proposal: null,
  provider: "project_state", limitations: [], observedProjectIds: [],
});
