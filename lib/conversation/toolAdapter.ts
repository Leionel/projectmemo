import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { searchMissionMemory } from "@/lib/mission/memorySearch";
import { readReviewMaterial } from "@/lib/mission/projectMaterialReader";
import { assertProject } from "./repository";
import { validateReadSources } from "./service";
import { investigationToolCallSchema } from "@/lib/types/agentExperience";
import type { ConversationActor, ConversationSource } from "@/lib/types/conversation";
import type { z } from "zod";
import { readSourceObservation } from "./sourceObservation";

export type MaterialPointer = { projectId: string; sourceId: string; revision: string; title: string; commitShas?: string[]; ciAccess?: string; repository?: import("@/lib/types/repositoryCi").RepositorySourceMeta };
export const workspaceReadTools = ["inspect_project", "search_memory", "read_project_material", "inspect_action"];
export function experienceSourceRef(s: ConversationSource) {
  return { kind: "SOURCE" as const, id: s.id, projectId: s.projectId, revision: s.revision };
}
export async function discoverMaterialPointers(actor: ConversationActor, projectIds: string[], sources: ConversationSource[]) {
  const pointers: MaterialPointer[] = sources.map(s => ({ projectId: s.projectId, sourceId: s.sourceId, revision: s.revision, title: s.title }));
  for (const projectId of projectIds) {
    await assertProject(actor, projectId);
    const connections = await db.sourceConnection.findMany({ where: { projectId, ownerUserId: actor.userId, status: "ACTIVE", revokedAt: null, project: { memberships: { some: { userId: actor.userId, role: "OWNER" } } } }, take: 3 });
    for (const c of connections) {
      const source = await readSourceObservation(actor, projectId, c.id);
      pointers.push({ projectId, sourceId: "repo:" + c.id, revision: source.revision, title: source.ref.title, commitShas: source.signalIds.slice(0, 5), ciAccess: source.access });
    }
    const ids = sources.filter(s => s.projectId === projectId && s.sourceId.startsWith("card:")).map(s => s.sourceId.slice(5));
    const cards = await db.knowledgeCard.findMany({ where: { projectId, id: { in: ids } }, take: 12,
      select: { captureId: true, attachmentId: true, title: true } });
    for (const c of cards) for (const sourceId of [c.captureId ? "capture:" + c.captureId : null, c.attachmentId ? "attachment:" + c.attachmentId : null]) {
      if (!sourceId) continue;
      const revision = await sourceHash(projectId, sourceId);
      if (revision) pointers.push({ projectId, sourceId, revision, title: c.title + (sourceId.startsWith("attachment:") ? " · 原文件" : " · 原始记录") });
    }
    const actions = await db.actionItem.findMany({ where: { projectId, isSimulated: false }, orderBy: { id: "asc" }, take: 12, select: { id: true, title: true } });
    // Unknown summary lineage must not cut off a fresh investigation of an accessible original.
    // Neutral metadata can locate the original without reusing the summary's claims or title.
    const originalCandidates = await db.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 16, select: { captureId: true, attachmentId: true } });
    for (const candidate of originalCandidates) for (const sourceId of ["capture:" + candidate.captureId, ...(candidate.attachmentId ? ["attachment:" + candidate.attachmentId] : [])]) {
      if ((await sourceUse(actor.userId, projectId, sourceId, db, { conversationId: actor.conversationId, ...(actor.missionId ? { missionId: actor.missionId } : {}) })).state !== "ALLOWED") continue;
      const revision = await sourceHash(projectId, sourceId);
      if (revision && !pointers.some(p => p.projectId === projectId && p.sourceId === sourceId)) pointers.push({ projectId, sourceId, revision, title: sourceId.startsWith("capture:") ? "可重新核对的原始记录" : "可重新核对的原文件" });
    }
    for (const action of actions) {
      const sourceId = "action:" + action.id, revision = await sourceHash(projectId, sourceId);
      if (revision) pointers.push({ projectId, sourceId, revision, title: action.title });
    }
    await assertProject(actor, projectId);
  }
  const allowedPointers = [];
  for (const p of pointers) if ((await sourceUse(actor.userId, p.projectId, p.sourceId, db, { conversationId: actor.conversationId, ...(actor.missionId ? { missionId: actor.missionId } : {}) })).state === "ALLOWED") allowedPointers.push(p);
  return [...new Map(allowedPointers.map(p => [p.projectId + "/" + p.sourceId, p])).values()].slice(0, 64);
}

/** Uses user/project readers directly; no synthetic mission actor and no write tool is exposed. */
export async function readWorkspaceTool(actor: ConversationActor, raw: z.infer<typeof investigationToolCallSchema>,
  projectIds: string[], pointers: MaterialPointer[], priorSources: ConversationSource[]) {
  const call = investigationToolCallSchema.parse(raw);
  if (call.tool === "read_repository_ci" || call.tool === "read_ci_jobs" || call.tool === "read_ci_log") throw new AppError("INVALID_TOOL_ACTOR", "CI 观察需要原 Turn 请求账本", 409);
  if (call.tool === "web_search" || call.tool === "web_fetch") throw new AppError("INVALID_TOOL_ACTOR", "公开研究需要原会话授权入口", 409);
  if (!projectIds.includes(call.projectId)) throw new AppError("INVALID_ROUTE", "本轮调查没有包含该项目", 409);
  await validateReadSources(actor, priorSources);
  await assertProject(actor, call.projectId);
  const observedAt = new Date().toISOString(), sources: ConversationSource[] = [];
  let data: unknown, coverage: Record<string, unknown> = { complete: false };
  function source(sourceId: string, revision: string, title: string, rawText: string, scope: "SUMMARY" | "EXCERPT" | "STRUCTURED", temporalState = "UNKNOWN", knowledgeClass = "PROJECT_OBSERVATION") {
    const excerpt = rawText.slice(0, scope === "SUMMARY" ? 1200 : 5000);
    sources.push({ id: call.projectId + "/" + sourceId, projectId: call.projectId, sourceId, revision, title, excerpt,
      observedAt, temporalState, knowledgeClass, start: 0, end: excerpt.length, excerptHash: jsonHash(excerpt), readScope: scope });
  }
  if (call.tool === "search_memory") {
    const result = await searchMissionMemory({ userId: actor.userId, projectId: call.projectId, conversationId: actor.conversationId, missionId: actor.missionId }, { query: call.query, limit: 3, ...(call.afterId ? { afterId: call.afterId } : {}) });
    data = result.data; coverage = result.coverage ?? coverage;
    for (const s of result.sources) source(s.id, s.hash, s.id, s.text, "SUMMARY", s.temporalState);
  } else if (call.tool === "read_project_material") {
    if (!pointers.some(p => p.projectId === call.projectId && p.sourceId === call.sourceId && p.revision === call.revision))
      throw new AppError("SOURCE_NOT_OBSERVED", "请先从授权检索中定位原资料", 409);
    if (call.sourceId.startsWith("web:")) {
      const original = priorSources.find(s => s.projectId === call.projectId && s.sourceId === call.sourceId && s.revision === call.revision && s.external);
      if (!original?.excerpt.trim()) throw new AppError("SOURCE_NOT_READABLE", "尚未取得该链接的正文，请使用网页读取工具或原文件", 409);
      sources.push(original); data = { title: original.title, content: original.excerpt, readScope: original.readScope, external: original.external, fromSavedSnapshot: true };
      coverage = { complete: false, description: "只回读已保存的网页片段，没有重新联网或升级阅读级别" };
    } else if (call.sourceId === "project:" + call.projectId) {
      const revision = await sourceHash(call.projectId, call.sourceId);
      if (revision !== call.revision) throw new AppError("SOURCE_CHANGED", "原项目已有修订，请重新定位", 409);
      const project = await db.project.findUniqueOrThrow({ where: { id: call.projectId }, select: { title: true, goal: true, deadline: true } });
      const actions = await db.actionItem.findMany({ where: { projectId: call.projectId, isSimulated: false }, take: 8, orderBy: { id: "asc" }, select: { id: true, title: true, status: true } });
      for (let i = actions.length - 1; i >= 0; i--) if ((await sourceUse(actor.userId, call.projectId, "action:" + actions[i].id, db, { conversationId: actor.conversationId, ...(actor.missionProjectId === call.projectId ? { missionId: actor.missionId } : {}) })).state !== "ALLOWED") actions.splice(i, 1);
      data = { project, actions }; source(call.sourceId, revision!, project.title, JSON.stringify(data), "STRUCTURED", "CURRENT");
      coverage = { complete: false, description: "原项目目标与最多8项行动，不代表全部资料" };
    } else if (call.sourceId.startsWith("repo:")) {
      const original = await readSourceObservation(actor, call.projectId, call.sourceId.slice(5));
      if (original.revision !== call.revision) throw new AppError("SOURCE_CHANGED", "仓库线索已有修订，请重新定位", 409);
      source(call.sourceId, original.revision, original.ref.title, original.text, "STRUCTURED", "UNKNOWN", "EXTERNAL_REFERENCE");
      data = { title: original.ref.title, content: original.text, goalImpact: "UNKNOWN", signalIds: original.signalIds };
      coverage = { complete: false, description: "已缓存仓库线索，不证明现实执行成功" };
    } else {
    const material = await readReviewMaterial(call.projectId, call.sourceId, db, actor.userId, { conversationId: actor.conversationId, ...(actor.missionProjectId === call.projectId ? { missionId: actor.missionId } : {}) });
    if (!material || material.source.hash !== call.revision) throw new AppError("SOURCE_CHANGED", "原资料已修订，请重新定位", 409);
    if (!material.source.text.trim()) throw new AppError("SOURCE_NOT_READABLE", "这份资料还没有可读正文", 409);
    source(call.sourceId, material.source.hash, material.title, material.source.text, material.readScope, material.source.temporalState, material.source.knowledgeClass ?? "PROJECT_OBSERVATION");
    data = { title: material.title, readScope: material.readScope, content: sources[0].excerpt };
    coverage = { ...material.coverage, loadedCharacters: sources[0].excerpt.length, complete: material.coverage.totalCharacters <= sources[0].excerpt.length };
    }
  } else if (call.tool === "inspect_action") {
    const pointer = pointers.find(p => p.projectId === call.projectId && p.sourceId === "action:" + call.actionId && p.revision === call.revision);
    const action = await db.actionItem.findFirst({ where: { id: call.actionId, projectId: call.projectId, isSimulated: false } });
    if (!pointer || !action || jsonHash(action) !== call.revision) throw new AppError("SOURCE_CHANGED", "原行动已变化或不可访问", 409);
    data = { id: action.id, title: action.title, status: action.status, resultCardId: action.resultCardId, description: action.description };
    source(pointer.sourceId, call.revision, action.title, JSON.stringify(data), "STRUCTURED", "CURRENT");
    coverage = { complete: true };
  } else {
    const before = await sourceHash(call.projectId, "project:" + call.projectId);
    const project = await db.project.findUniqueOrThrow({ where: { id: call.projectId }, select: { title: true, goal: true, deadline: true } });
    const actions = await db.actionItem.findMany({ where: { projectId: call.projectId, isSimulated: false,
      ...(call.afterId ? { id: { gt: call.afterId } } : {}) }, orderBy: { id: "asc" }, take: 9, select: { id: true, title: true, status: true } });
    const nextCursor = actions.length > 8 ? actions[7].id : null;
    actions.splice(8);
    for (let i = actions.length - 1; i >= 0; i--) if ((await sourceUse(actor.userId, call.projectId, "action:" + actions[i].id, db, { conversationId: actor.conversationId, ...(actor.missionProjectId === call.projectId ? { missionId: actor.missionId } : {}) })).state !== "ALLOWED") actions.splice(i, 1);
    if (before !== await sourceHash(call.projectId, "project:" + call.projectId)) throw new AppError("SOURCE_CHANGED", "项目刚发生变化", 409);
    data = { project, actions: actions.slice(0, 8) }; coverage = { complete: !call.afterId && !nextCursor, nextCursor };
    source("project:" + call.projectId, before!, project.title, JSON.stringify(data), "STRUCTURED", "CURRENT");
  }
  await validateReadSources(actor, [...priorSources, ...sources]);
  const discovered = await discoverMaterialPointers(actor, [call.projectId], sources);
  await validateReadSources(actor, [...priorSources, ...sources]);
  return { data, coverage, sources, discovered };
}
