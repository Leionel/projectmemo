import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { conversationCreateSchema, focusPreferenceSchema } from "@/lib/types/conversation";
import type { ConversationActor, ConversationBlocks, ConversationView, ConversationRef } from "@/lib/types/conversation";
import { assertProject, assertSession, emptyBlocks, lockConversation, ownedConversation, record, type Tx } from "./repository";
import { openConversationEntry } from "./anchorService";

export async function appendConversationMessage(tx: Tx, conversationId: string, ownerUserId: string,
  role: "USER" | "ASSISTANT", content: string, blocks: ConversationBlocks, turnId?: string, runId?: string) {
  const c = await tx.conversation.update({ where: { id: conversationId }, data: { nextSeq: { increment: 1 } } });
  return tx.agentMessage.create({ data: { projectId: null, conversationId, turnId, seq: c.nextSeq,
    ownerUserId, role, content, blocksJson: json(blocks), citations: [], proposedActions: [], runId } });
}
export async function bindRefs(tx: Tx, conversationId: string, refs: ConversationRef[]) {
  const output: ConversationRef[] = [];
  for (const ref of refs) {
    const revisionKey = ref.version?.toString() ?? "";
    const binding = await tx.conversationBinding.upsert({
      where: { conversationId_kind_entityId_revisionKey: { conversationId, kind: ref.kind, entityId: ref.id, revisionKey } },
      create: { conversationId, projectId: ref.projectId, kind: ref.kind, entityId: ref.id, revisionKey, valueJson: json(ref) },
      update: {},
    });
    await tx.conversationProject.upsert({ where: { conversationId_projectId: { conversationId, projectId: ref.projectId } },
      create: { conversationId, projectId: ref.projectId }, update: {} });
    output.push({ ...ref, bindingId: binding.id });
  }
  return output;
}
export async function createConversation(actor: ConversationActor, raw: unknown) {
  await assertSession(actor);
  const input = conversationCreateSchema.parse(raw), hash = jsonHash(input);
  if (input.entry) return openConversationEntry(actor, input);
  if (input.projectId) await assertProject(actor, input.projectId);
  const old = await db.conversation.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: actor.userId, createRequestId: input.requestId } } });
  if (old) {
    if (old.createInputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一段讨论", 409);
    await ownedConversation(actor, old.id);
    return { id: old.id };
  }
  try {
    return await db.$transaction(async tx => {
      await tx.authSession.updateMany({ where: { id: actor.sessionId, userId: actor.userId }, data: { id: actor.sessionId } });
      await assertSession(actor, tx);
      if (await tx.conversationEntryRequest.findUnique({ where: { ownerUserId_requestId: { ownerUserId: actor.userId, requestId: input.requestId } } }))
        throw new AppError("REQUEST_ID_REUSED", "请求编号已用于提醒入口", 409);
      const replay = await tx.conversation.findUnique({ where: { ownerUserId_createRequestId: { ownerUserId: actor.userId, createRequestId: input.requestId } } });
      if (replay) {
        if (replay.createInputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一段讨论", 409);
        await ownedConversation(actor, replay.id, tx); return { id: replay.id };
      }
      if (input.projectId) await assertProject(actor, input.projectId, tx);
      const c = await tx.conversation.create({ data: { ownerUserId: actor.userId, createRequestId: input.requestId,
        createInputHash: hash, scope: input.scope, homeProjectId: input.scope === "PROJECT" ? input.projectId : null,
        title: input.title ?? "项目协作",
        focusJson: json({ projectId: input.projectId ?? null }) } });
      if (input.projectId) await tx.conversationProject.create({ data: { conversationId: c.id, projectId: input.projectId } });
      return { id: c.id };
    });
  } catch (error) {
    if ((error as { code?: string }).code !== "P2002") throw error;
    const existing = await db.conversation.findUniqueOrThrow({ where: { ownerUserId_createRequestId: {
      ownerUserId: actor.userId, createRequestId: input.requestId } } });
    if (existing.createInputHash !== hash) throw new AppError("REQUEST_ID_REUSED", "请求编号已用于另一段讨论", 409);
    return { id: existing.id };
  }
}
export async function listConversations(actor: ConversationActor, projectId?: string, cursor?: string) {
  await assertSession(actor);
  if (projectId) await assertProject(actor, projectId);
  const rows = await db.conversation.findMany({ where: { ownerUserId: actor.userId, status: "ACTIVE",
    ...(projectId ? { projects: { some: { projectId } } } : {}), ...(cursor ? { id: { lt: cursor } } : {}) },
    orderBy: { id: "desc" }, take: 21, select: { id: true, title: true, scope: true, homeProjectId: true,
      projects: { select: { projectId: true } } } });
  const memberships = await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true } });
  const allowed = new Set(memberships.map(m => m.projectId));
  return { conversations: rows.slice(0, 20).map(({ projects, ...row }) => ({
    ...row, title: projects.some(p => !allowed.has(p.projectId)) ? "部分历史不可用的讨论" : row.title,
  })), nextCursor: rows.length > 20 ? rows[19].id : null };
}
export async function readConversation(actor: ConversationActor, id: string, beforeSeq?: number): Promise<ConversationView> {
  const c = await ownedConversation(actor, id);
  const [memberships, rows, linked, active] = await Promise.all([
    db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } }),
    db.agentMessage.findMany({ where: { conversationId: id, ownerUserId: actor.userId, ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) },
      orderBy: { seq: "desc" }, take: 51 }),
    db.project.findMany({ where: { memberships: { some: { userId: actor.userId } },
      id: { in: (await db.conversationProject.findMany({ where: { conversationId: id } })).map(p => p.projectId) } },
      select: { id: true, title: true } }),
    c.activeTurnId ? db.conversationTurn.findUnique({ where: { id: c.activeTurnId } }) : null,
  ]);
  const allowed = new Set(memberships.map(m => m.projectId)), owners = new Set(memberships.filter(m => m.role === "OWNER").map(m => m.projectId));
  const messages: ConversationView["messages"] = [];
  for (const row of rows.slice(0, 50).reverse()) {
    const blocks = { ...emptyBlocks(), ...record(row.blocksJson) } as ConversationBlocks;
    let restricted = blocks.observedProjectIds.some(p => !allowed.has(p)) ||
      blocks.refs.some(ref => ["MISSION", "GOAL_QUESTION", "IMPACT"].includes(ref.kind) && !owners.has(ref.projectId));
    for (const ref of blocks.refs.filter(r => r.kind === "MISSION")) {
      if (!await db.agentMission.findFirst({ where: { id: ref.id, projectId: ref.projectId, ownerUserId: actor.userId } })) restricted = true;
    }
    if (restricted) {
      messages.push({ ...emptyBlocks(), id: row.id, seq: row.seq!, role: row.role, content: "部分历史已不可访问", restricted: true });
      continue;
    }
    if (blocks.proposal) {
      const e = await db.copilotToolExecution.findFirst({ where: { id: blocks.proposal.executionId,
        sourceRun: { conversationId: id } } });
      if (e) {
        const action = e.resultId ? !["create_action", "complete_action"].includes(e.tool)
          ? await db.agentMission.findFirst({ where: { id: e.resultId, projectId: blocks.proposal.projectId, ownerUserId: actor.userId } })
          : await db.actionItem.findFirst({ where: { id: e.resultId, projectId: blocks.proposal.projectId, isSimulated: false } }) : null;
        blocks.proposal = { ...blocks.proposal, status: e.status, resultId: e.resultId, actionStatus: action?.status ?? null,
          resultCardId: action && "resultCardId" in action ? action.resultCardId : null };
      }
    }
    messages.push({ ...blocks, id: row.id, seq: row.seq!, role: row.role, content: row.content, restricted: false });
  }
  await assertSession(actor);
  const latestMemberships = await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } });
  const latestAllowed = new Set(latestMemberships.map(m => m.projectId));
  const latestOwners = new Set(latestMemberships.filter(m => m.role === "OWNER").map(m => m.projectId));
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    if (message.observedProjectIds.some(p => !latestAllowed.has(p)) ||
      message.refs.some(r => ["MISSION", "GOAL_QUESTION", "IMPACT"].includes(r.kind) && !latestOwners.has(r.projectId))) {
      messages[index] = { ...emptyBlocks(), id: message.id, seq: message.seq, role: message.role, content: "部分历史已不可访问", restricted: true };
    }
  }
  if (c.homeProjectId && !latestAllowed.has(c.homeProjectId)) throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化", 404);
  const focus = record(c.focusJson), focusProjectId = typeof focus.projectId === "string" && latestAllowed.has(focus.projectId) ? focus.projectId : null;
  return { schemaVersion: 1, id, title: messages.some(m => m.restricted) ? "项目协作" : c.title,
    scope: c.scope, homeProjectId: c.homeProjectId, version: c.version, focusProjectId,
    messages, linkedProjects: linked.filter(p => latestAllowed.has(p.id)), hasMore: rows.length > 50, beforeSeq: rows.length ? rows[Math.min(49, rows.length - 1)].seq : null,
    activeTurn: active ? { id: active.id, requestId: active.requestId, status: active.status } : null };
}
export async function saveFocusPreference(actor: ConversationActor, projectId: string, raw: unknown) {
  const input = focusPreferenceSchema.parse(raw);
  return db.$transaction(async tx => {
    await assertProject(actor, projectId, tx);
    await tx.$executeRaw`UPDATE "ProjectMembership" SET "id" = "id" WHERE "userId" = ${actor.userId} AND "projectId" = ${projectId}`;
    const previous = await tx.focusProjectPreference.findUnique({ where: { userId_projectId: { userId: actor.userId, projectId } } });
    if ((previous?.version ?? 0) !== input.expectedVersion) throw new AppError("PREFERENCE_CHANGED", "偏好已在其他设备更新，请刷新", 409);
    const { expectedVersion: _version, ...data } = input;
    void _version;
    return tx.focusProjectPreference.upsert({ where: { userId_projectId: { userId: actor.userId, projectId } },
      create: { userId: actor.userId, projectId, ...data }, update: { ...data, version: { increment: 1 } } });
  });
}
export async function validateReadSources(actor: ConversationActor, sources: ConversationBlocks["sources"], tx: Tx = db) {
  for (const source of sources) {
    const member = await assertProject(actor, source.projectId, tx);
    const mission = source.sourceId.startsWith("mission:") && member.role === "OWNER"
      ? await tx.agentMission.findFirst({ where: { id: source.sourceId.slice(8), projectId: source.projectId, ownerUserId: actor.userId } }) : null;
    const hash = source.sourceId.startsWith("mission:") ? mission?.version.toString() ?? null : await sourceHash(source.projectId, source.sourceId, tx);
    if (hash !== source.revision)
      throw new AppError("SOURCE_CHANGED", "本次读取的资料已变化，请重新提问", 409);
  }
}
export { ownedConversation, lockConversation };
