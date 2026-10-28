import { assertContinuityBinding, boundDirectiveScope } from "@/lib/continuity/directiveService";
import { readContinuity } from "@/lib/continuity/handoff";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertSourceUse, sourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { conversationCreateSchema, focusPreferenceSchema } from "@/lib/types/conversation";
import type { ConversationActor, ConversationBlocks, ConversationView, ConversationRef } from "@/lib/types/conversation";
import { assertProject, assertSession, emptyBlocks, lockConversation, ownedConversation, record, type Tx } from "./repository";
import { openConversationEntry } from "./anchorService";
import { discussionTitle, hasDefaultDiscussionTitle } from "./presentation";
import { resolveFileGuides } from "./fileGuides";
import { experienceProgress } from "./progress";
import { refreshExperiencePresentation } from "./presentationRuntime";
import type { R4State } from "./investigationService";
import { eventPresentation } from "./eventPresentation";
import { reviewPresentation } from "./reviewPresentation";
import { readResearchScope, validateWebSource } from "./researchScope";
import { readSourceObservation } from "./sourceObservation";

export async function appendConversationMessage(tx: Tx, conversationId: string, ownerUserId: string,
  role: "USER" | "ASSISTANT", content: string, blocks: ConversationBlocks, turnId?: string, runId?: string) {
  const c = await tx.conversation.update({ where: { id: conversationId }, data: { nextSeq: { increment: 1 } } });
  if (role === "USER" && hasDefaultDiscussionTitle(c.title)) {
    const first = await tx.agentMessage.findFirst({ where: { conversationId, role: "USER", ownerUserId }, orderBy: { seq: "asc" }, select: { content: true, blocksJson: true } });
    const firstProjects = first ? record(first.blocksJson).observedProjectIds : blocks.observedProjectIds;
    const projectId = c.homeProjectId ?? (Array.isArray(firstProjects) && typeof firstProjects[0] === "string" ? firstProjects[0] : null)
      ?? (typeof record(c.focusJson).projectId === "string" ? record(c.focusJson).projectId as string : null);
    const project = projectId ? await tx.project.findFirst({ where: { id: projectId, memberships: { some: { userId: ownerUserId } } }, select: { title: true } }) : null;
    await tx.conversation.update({ where: { id: conversationId }, data: { title: discussionTitle(first?.content ?? content, project?.title) } });
  }
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
  const memberships = await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } });
  const allowed = new Set(memberships.map(m => m.projectId));
  const privateBindings = await db.conversationBinding.findMany({ where: { conversationId: { in: rows.map(c => c.id) },
    kind: { in: ["MISSION", "GOAL_QUESTION", "IMPACT"] }, projectId: { notIn: memberships.filter(m => m.role === "OWNER").map(m => m.projectId) } }, select: { conversationId: true } });
  const restricted = new Set(privateBindings.map(b => b.conversationId));
  const observedConnections = await db.conversationAnchor.findMany({ where: { conversationId: { in: rows.map(c => c.id) }, originKind: "SOURCE_OBSERVATION" } });
  for (const anchor of observedConnections) {
    try { await readSourceObservation(actor, anchor.projectId, anchor.originId); } catch { restricted.add(anchor.conversationId); }
  }
  const titleScopes = new Map(rows.map(row => [row.id, row.projects.map(p => p.projectId)]));
  const conversations = await Promise.all(rows.slice(0, 20).map(async ({ projects, ...row }) => {
    if (restricted.has(row.id) || projects.some(p => !allowed.has(p.projectId))) return { ...row, title: "部分历史不可用的讨论" };
    if (!hasDefaultDiscussionTitle(row.title)) return row;
    const first = await db.agentMessage.findFirst({ where: { conversationId: row.id, role: "USER", ownerUserId: actor.userId }, orderBy: { seq: "asc" }, select: { content: true, blocksJson: true } });
    const scopes = first && Array.isArray(record(first.blocksJson).observedProjectIds) ? record(first.blocksJson).observedProjectIds as string[] : [];
    titleScopes.set(row.id, [...titleScopes.get(row.id)!, ...scopes]);
    if (scopes.some(p => !allowed.has(p))) return { ...row, title: "部分历史不可用的讨论" };
    const projectId = row.homeProjectId ?? scopes[0];
    const project = projectId ? await db.project.findFirst({ where: { id: projectId, memberships: { some: { userId: actor.userId } } }, select: { title: true } }) : null;
    return { ...row, title: first ? discussionTitle(first.content, project?.title) : project ? project.title.slice(0, 20) + " · 新讨论" : "新讨论" };
  }));
  // Recheck after reading titles: a mixed-project title must not survive scope revocation.
  await assertSession(actor);
  const latest = await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } });
  const latestAllowed = new Set(latest.map(m => m.projectId));
  const latestOwners = new Set(latest.filter(m => m.role === "OWNER").map(m => m.projectId));
  for (const row of conversations) {
    if (titleScopes.get(row.id)!.some(p => !latestAllowed.has(p)) ||
      await db.conversationBinding.findFirst({ where: { conversationId: row.id, kind: { in: ["MISSION", "GOAL_QUESTION", "IMPACT"] }, projectId: { notIn: [...latestOwners] } } })) row.title = "部分历史不可用的讨论";
  }
  return { conversations, nextCursor: rows.length > 20 ? rows[19].id : null };
}
export async function readConversation(actor: ConversationActor, id: string, beforeSeq?: number): Promise<ConversationView> {
  const c = await ownedConversation(actor, id);
  const [memberships, rows, linked, active, latest] = await Promise.all([
    db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } }),
    db.agentMessage.findMany({ where: { conversationId: id, ownerUserId: actor.userId, ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) },
      orderBy: { seq: "desc" }, take: 51 }),
    db.project.findMany({ where: { memberships: { some: { userId: actor.userId } },
      id: { in: (await db.conversationProject.findMany({ where: { conversationId: id } })).map(p => p.projectId) } },
      select: { id: true, title: true } }),
    c.activeTurnId ? db.conversationTurn.findUnique({ where: { id: c.activeTurnId } }) : null,
    db.conversationTurn.findFirst({ where: { conversationId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const allowed = new Set(memberships.map(m => m.projectId)), owners = new Set(memberships.filter(m => m.role === "OWNER").map(m => m.projectId));
  const messages: ConversationView["messages"] = [];
  for (const row of rows.slice(0, 50).reverse()) {
    const blocks = { ...emptyBlocks(), ...record(row.blocksJson) } as ConversationBlocks;
    let webRestricted = false;
    try {
      for (const source of blocks.sources) if ((await sourceUse(actor.userId, source.projectId, source.sourceId, db, { conversationId: id })).state !== "ALLOWED") webRestricted = true;
      for (const source of blocks.sources.filter(s => s.external)) await validateWebSource(actor, source);
      for (const source of blocks.sources.filter(s => s.sourceId.startsWith("repo:"))) await readSourceObservation(actor, source.projectId, source.sourceId.slice(5));
      if (blocks.observationRef?.kind === "SOURCE_OBSERVATION") await readSourceObservation(actor, blocks.observationRef.projectId, blocks.observationRef.id);
    } catch { webRestricted = true; }
    let restricted = webRestricted || blocks.observedProjectIds.some(p => !allowed.has(p)) ||
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
        sourceRun: { conversationId: id } }, include: { sourceRun: true } });
      if (e) {
        const action = e.resultId ? !["create_action", "complete_action"].includes(e.tool)
          ? await db.agentMission.findFirst({ where: { id: e.resultId, projectId: blocks.proposal.projectId, ownerUserId: actor.userId } })
          : await db.actionItem.findFirst({ where: { id: e.resultId, projectId: blocks.proposal.projectId, isSimulated: false } }) : null;
        blocks.proposal = { ...blocks.proposal, status: e.status, resultId: e.resultId, actionStatus: action?.status ?? null,
          resultCardId: action && "resultCardId" in action ? action.resultCardId : null };
        if (e.status === "PENDING") try { await assertContinuityBinding(actor.userId, boundDirectiveScope(record(e.proposalJson).continuity ?? record(e.sourceRun.trace).continuity, blocks.proposal.projectId, id), record(e.proposalJson).continuity ?? record(e.sourceRun.trace).continuity); }
        catch (error) { if (error instanceof AppError) blocks.proposal.status = "STALE"; else throw error; }
      }
    }
    blocks.fileGuides = await resolveFileGuides(blocks.sources, blocks.citations, blocks.fileGuides);
    if (blocks.presentationPlan && row.turnId) {
      const turn = await db.conversationTurn.findUnique({ where: { id: row.turnId } });
      const experience = record(turn?.readManifestJson).experience;
      if (record(experience).policyVersion === "r4-v1") {
        try { blocks.presentation = await refreshExperiencePresentation(actor, id, blocks, experience as R4State, row.turnId); }
        catch { blocks.presentation = undefined; }
      } else blocks.presentation = undefined;
    } else if (blocks.reviewRef) {
      try { blocks.presentation = await reviewPresentation(actor, id, blocks); }
      catch { blocks.presentation = undefined; }
    } else if (blocks.changeNotice) {
      try { blocks.presentation = await eventPresentation(actor, id, row.id, blocks); }
      catch { blocks.presentation = undefined; }
    } else blocks.presentation = undefined;
    delete blocks.presentationPlan;
    delete blocks.changeNotice;
    messages.push({ ...blocks, id: row.id, seq: row.seq!, role: row.role, content: row.content, restricted: false });
  }
  await assertSession(actor);
  const latestMemberships = await db.projectMembership.findMany({ where: { userId: actor.userId }, select: { projectId: true, role: true } });
  const latestAllowed = new Set(latestMemberships.map(m => m.projectId));
  const latestOwners = new Set(latestMemberships.filter(m => m.role === "OWNER").map(m => m.projectId));
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];
    let webRestricted = false;
    try {
      for (const source of message.sources.filter(s => s.external)) await validateWebSource(actor, source);
      for (const source of message.sources.filter(s => s.sourceId.startsWith("repo:"))) await readSourceObservation(actor, source.projectId, source.sourceId.slice(5));
      if (message.observationRef?.kind === "SOURCE_OBSERVATION") await readSourceObservation(actor, message.observationRef.projectId, message.observationRef.id);
    } catch { webRestricted = true; }
    if (webRestricted || message.observedProjectIds.some(p => !latestAllowed.has(p)) ||
      message.refs.some(r => ["MISSION", "GOAL_QUESTION", "IMPACT"].includes(r.kind) && !latestOwners.has(r.projectId))) {
      messages[index] = { ...emptyBlocks(), id: message.id, seq: message.seq, role: message.role, content: "部分历史已不可访问", restricted: true };
    }
  }
  if (c.homeProjectId && !latestAllowed.has(c.homeProjectId)) throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化", 404);
  const focus = record(c.focusJson), focusProjectId = typeof focus.projectId === "string" && latestAllowed.has(focus.projectId) ? focus.projectId : null;
  let title = c.title;
  if (hasDefaultDiscussionTitle(title)) {
    const first = await db.agentMessage.findFirst({ where: { conversationId: id, ownerUserId: actor.userId, role: "USER" }, orderBy: { seq: "asc" }, select: { content: true, blocksJson: true } });
    const scopes = first && Array.isArray(record(first.blocksJson).observedProjectIds) ? record(first.blocksJson).observedProjectIds as string[] : [];
    const projectId = c.homeProjectId ?? scopes[0];
    title = first ? scopes.some(p => !latestAllowed.has(p)) ? "项目协作" : discussionTitle(first.content, linked.find(p => p.id === projectId)?.title) : "新讨论";
  }
  return { schemaVersion: 1, id, title: messages.some(m => m.restricted) ? "项目协作" : title,
    continuity: (isFeatureEnabled("FOCUS_CONTINUITY_ENABLED", false) || (await db.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { continuitySeq: true } })).continuitySeq > 0) ? await readContinuity(actor, id) ?? undefined : undefined,
    research: await readResearchScope(actor, id),
    scope: c.scope, homeProjectId: c.homeProjectId, version: c.version, focusProjectId,
    messages, linkedProjects: linked.filter(p => latestAllowed.has(p.id)), hasMore: rows.length > 50, beforeSeq: rows.length ? rows[Math.min(49, rows.length - 1)].seq : null,
    activeTurn: active && !messages.some(m => m.restricted) ? { id: active.id, requestId: active.requestId, status: active.status, progress: experienceProgress(active.readManifestJson) } : null,
    latestTurn: latest && !messages.some(m => m.restricted) ? { id: latest.id, status: latest.status,
      canRetry: ["FAILED", "UNKNOWN"].includes(latest.status),
      message: latest.status === "UNKNOWN" ? "上次分析中断，暂未取得可用回答。你可以读取状态，或重新提问。"
        : latest.status === "FAILED" ? "这次分析未完成，你可以重新提问。"
        : ["OBSERVING", "GENERATING", "ACCEPTED"].includes(latest.status) ? "正在核对项目资料…" : "" } : null };
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
    await assertSourceUse(actor.userId, source.projectId, source.sourceId, tx, { conversationId: actor.conversationId, ...(actor.missionId ? { missionId: actor.missionId } : {}) });
    if (source.external) { await validateWebSource(actor, source, tx); continue; }
    if (source.sourceId.startsWith("repo:")) {
      if ((await readSourceObservation(actor, source.projectId, source.sourceId.slice(5), tx)).revision !== source.revision) throw new AppError("SOURCE_CHANGED", "仓库线索已变化", 409);
      continue;
    }
    const member = await assertProject(actor, source.projectId, tx);
    const mission = source.sourceId.startsWith("mission:") && member.role === "OWNER"
      ? await tx.agentMission.findFirst({ where: { id: source.sourceId.slice(8), projectId: source.projectId, ownerUserId: actor.userId } }) : null;
    const hash = source.sourceId.startsWith("mission:") ? mission?.version.toString() ?? null : await sourceHash(source.projectId, source.sourceId, tx);
    if (hash !== source.revision)
      throw new AppError("SOURCE_CHANGED", "本次读取的资料已变化，请重新提问", 409);
  }
}
export { ownedConversation, lockConversation };
