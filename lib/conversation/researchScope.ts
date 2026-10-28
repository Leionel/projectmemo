import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { researchScopeSchema } from "@/lib/types/mission";
import { conversationResearchScopeSchema } from "@/lib/types/conversationResearch";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertProject, lockConversation, ownedConversation, record } from "./repository";
import type { ConversationActor, ConversationSource } from "@/lib/types/conversation";
import type { Prisma } from "@/lib/generated/prisma/client";

export async function readResearchScope(actor: ConversationActor, id: string, tx: Prisma.TransactionClient = db) {
  const c = await ownedConversation(actor, id, tx), config = record(c.researchScopeJson);
  const scope = researchScopeSchema.parse(config.scope ?? {}), projectId = typeof config.projectId === "string" ? config.projectId : c.homeProjectId;
  if (projectId) await assertProject(actor, projectId, tx);
  return { available: isFeatureEnabled("FOCUS_WEB_ENABLED", false), revision: c.researchScopeVersion, projectId, scope };
}
export async function updateResearchScope(actor: ConversationActor, id: string, raw: unknown) {
  const input = conversationResearchScopeSchema.parse(raw);
  if (!isFeatureEnabled("FOCUS_WEB_ENABLED", false)) throw new AppError("WEB_DISABLED", "当前公开研究功能已关闭", 503);
  return db.$transaction(async tx => {
    await lockConversation(tx, id); const c = await ownedConversation(actor, id, tx);
    await assertProject(actor, input.projectId, tx);
    if (c.scope === "PROJECT" && c.homeProjectId !== input.projectId) throw new AppError("CONTEXT_SCOPE_CHANGED", "研究范围需要关联当前项目", 409);
    if (c.researchScopeVersion !== input.expectedRevision) throw new AppError("SCOPE_CHANGED", "公开研究范围已变化，请刷新", 409);
    await tx.conversation.update({ where: { id }, data: { researchScopeJson: json({ projectId: input.projectId, scope: input.scope }), researchScopeVersion: { increment: 1 } } });
    return readResearchScope(actor, id, tx);
  });
}
/** A snapshot is usable only while the original private conversation and its grant remain accessible. */
export async function validateWebSource(actor: ConversationActor, source: ConversationSource, tx: Prisma.TransactionClient = db) {
  const meta = source.external;
  if (!meta || !source.sourceId.startsWith("web:")) throw new AppError("SOURCE_NOT_FOUND", "未找到原网页来源", 404);
  const current = await readResearchScope(actor, meta.conversationId, tx);
  if (current.revision !== meta.scopeRevision || (meta.origin === "SEARCH" && !current.scope.enabled)) throw new AppError("SCOPE_CHANGED", "该网页的研究授权已变化", 409);
  await assertProject(actor, source.projectId, tx);
  const turn = await tx.conversationTurn.findFirst({ where: { id: meta.turnId, conversationId: meta.conversationId } });
  const saved = record(turn?.readManifestJson).webSources as ConversationSource[] | undefined;
  if (!saved?.some(s => s.sourceId === source.sourceId && s.revision === source.revision && jsonHash(s) === jsonHash(source)))
    throw new AppError("SOURCE_CHANGED", "原网页片段已不可核对", 409);
}
