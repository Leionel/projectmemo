import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { jsonHash } from "@/lib/mission/contracts";
import { sourceHash } from "@/lib/mission/repository";
import { searchMissionMemory } from "@/lib/mission/memorySearch";
import { assertProject, assertSession } from "@/lib/conversation/repository";
import { explainPriority } from "@/lib/conversation/priority";
import type { ConversationActor, ConversationRef, ConversationSource } from "@/lib/types/conversation";

export async function workspaceDirectory(actor: ConversationActor, scope: string, homeProjectId: string | null, targeted?: string) {
  await assertSession(actor);
  if (targeted) await assertProject(actor, targeted);
  const where = { memberships: { some: { userId: actor.userId } },
    ...(homeProjectId ? { id: homeProjectId } : { archivedAt: null }) };
  const [total, page] = await Promise.all([
    db.project.count({ where }),
    db.project.findMany({ where, orderBy: { id: "asc" }, take: 61,
      select: { id: true, title: true, goal: true, deadline: true, archivedAt: true } }),
  ]);
  const rows = page.slice(0, 60);
  if (scope === "PROJECT" && targeted && targeted !== homeProjectId)
    throw new AppError("CONTEXT_SCOPE_CHANGED", "这段讨论限定在原项目，请另开跨项目讨论", 409);
  if (targeted && !rows.some(p => p.id === targeted)) {
    const named = await db.project.findUniqueOrThrow({ where: { id: targeted },
      select: { id: true, title: true, goal: true, deadline: true, archivedAt: true } });
    rows.push(named);
  }
  const preferences = await db.focusProjectPreference.findMany({ where: { userId: actor.userId, projectId: { in: rows.map(p => p.id) } } });
  const summaries = await Promise.all(rows.map(async p => {
    const member = await assertProject(actor, p.id);
    const privateMissions = member.role === "OWNER" && isFeatureEnabled("MISSION_ENABLED", false);
    const missionWhere = { projectId: p.id, ownerUserId: actor.userId, status: { notIn: ["SUCCEEDED", "CANCELLED"] } };
    const [actions, missions, actionCount, waiting, blocked, missionCount, reminders] = await Promise.all([
      db.actionItem.findMany({ where: { projectId: p.id, isSimulated: false, status: { in: ["TODO", "DOING"] } },
        orderBy: [{ priority: "desc" }, { id: "asc" }], take: 4, select: { id: true, title: true, status: true, dueAt: true } }),
      privateMissions ? db.agentMission.findMany({ where: missionWhere, take: 4, orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        select: { id: true, goal: true, status: true, version: true, planRevision: true, contextVersion: true, pauseReason: true } }) : [],
      db.actionItem.count({ where: { projectId: p.id, isSimulated: false, status: { in: ["TODO", "DOING"] } } }),
      privateMissions ? db.agentMission.count({ where: { ...missionWhere, status: { in: ["WAITING_INPUT", "WAITING_APPROVAL"] } } }) : 0,
      privateMissions ? db.agentMission.count({ where: { ...missionWhere, status: { in: ["PAUSED", "FAILED"] } } }) : 0,
      privateMissions ? db.agentMission.count({ where: missionWhere }) : 0,
      db.agentIntervention.findMany({ where: { projectId: p.id, isSimulated: false, status: "OPEN", NOT: { dedupeKey: { startsWith: "goal:" } } },
        take: 2, orderBy: [{ severity: "desc" }, { id: "asc" }], select: { id: true, title: true, content: true } }),
    ]);
    const pref = preferences.find(v => v.projectId === p.id);
    const preference = pref ? { importance: pref.importance, longTermGoal: pref.longTermGoal,
      estimatedMinutes: pref.estimatedMinutes, notes: pref.notes, version: pref.version } : null;
    const summary = { id: p.id, title: p.title, goal: p.goal, deadline: p.deadline?.toISOString() ?? null,
      archived: !!p.archivedAt, actions, actionCount, missions, missionCount, waiting, blocked, reminders, preference,
      coverage: { actionsComplete: actionCount <= 4, missionsComplete: missionCount <= 4, remindersLimit: 2 } };
    return { ...summary, priority: explainPriority(summary), observationHash: jsonHash(summary) };
  }));
  return { summaries, coverage: { totalProjects: total, observedProjects: summaries.length, complete: total <= 60,
    nextCursor: total > 60 ? rows[59]?.id ?? null : null, policy: "AUTHORIZED_DIRECTORY_3x20",
    limitations: ["每项目只列部分任务和提醒；计数覆盖授权范围", "目录超过60项时需限定项目，不能宣称全局最优"] } };
}
export type WorkspaceDirectory = Awaited<ReturnType<typeof workspaceDirectory>>;

export async function observeProjects(actor: ConversationActor, directory: WorkspaceDirectory, projectIds: string[], query: string,
  entityRef?: { kind: "MISSION" | "ACTION"; id: string; projectId: string }) {
  const sources: ConversationSource[] = [], refs: ConversationRef[] = [];
  const observedAt = new Date().toISOString();
  const projects = directory.summaries.filter(p => projectIds.includes(p.id)).slice(0, 3);
  for (const p of projects) {
    const member = await assertProject(actor, p.id);
    refs.push({ kind: "PROJECT", id: p.id, projectId: p.id, title: p.title, href: "/projects/" + p.id + "/knowledge" });
    for (const m of p.missions) refs.push({ kind: "MISSION", id: m.id, projectId: p.id, title: m.goal,
      status: m.status, version: m.version, href: "/projects/" + p.id + "/missions?mission=" + encodeURIComponent(m.id) });
    if (entityRef?.projectId === p.id && entityRef.kind === "MISSION") {
      const m = member.role === "OWNER" ? await db.agentMission.findFirst({ where: { id: entityRef.id, projectId: p.id, ownerUserId: actor.userId } }) : null;
      if (!m) throw new AppError("MISSION_NOT_FOUND", "原委托不可访问", 404);
      const events = await db.agentMissionEvent.findMany({ where: { missionId: m.id,
        type: { in: ["QUESTION", "INPUT", "PAUSE", "CONSTRAINTS_CHANGED", "IMPACT_REASSESSMENT_REQUIRED"] } },
        orderBy: { seq: "desc" }, take: 4, select: { id: true, seq: true, type: true, payloadJson: true } });
      if (!refs.some(r => r.id === m.id)) refs.push({ kind: "MISSION", id: m.id, projectId: p.id, title: m.goal,
        status: m.status, version: m.version, href: "/projects/" + p.id + "/missions?mission=" + m.id });
      const text = JSON.stringify({ goal: m.goal, status: m.status, pauseReason: m.pauseReason, events }).slice(0, 1800);
      sources.push({ id: p.id + "/mission:" + m.id, projectId: p.id, sourceId: "mission:" + m.id, revision: String(m.version),
        title: "原委托状态与最近事件", excerpt: text, observedAt, temporalState: "CURRENT", knowledgeClass: "PROJECT_OBSERVATION",
        start: 0, end: text.length, excerptHash: jsonHash(text) });
    }
    if (entityRef?.projectId === p.id && entityRef.kind === "ACTION") {
      const action = await db.actionItem.findFirst({ where: { id: entityRef.id, projectId: p.id, isSimulated: false } });
      if (!action) throw new AppError("ACTION_NOT_FOUND", "原行动不可访问", 404);
      refs.push({ kind: "ACTION", id: action.id, projectId: p.id, title: action.title, status: action.status,
        href: "/projects/" + p.id + "/actions#action-" + action.id });
    }
    const hash = await sourceHash(p.id, "project:" + p.id);
    const excerpt = [p.title, "项目目标：" + p.goal, "截止日期：" + (p.deadline ?? "未知"), "未完成行动：" + p.actionCount + " 项", "待回应委托：" + p.waiting + " 项", "阻塞项：" + p.blocked + " 项",
      ...p.missions.map(m => "委托：" + m.goal + "；状态：" + m.status), ...p.actions.map(a => "行动：" + a.title + "；状态：" + a.status)].join("\n").slice(0, 1800);
    sources.push({ id: p.id + "/project:" + p.id, projectId: p.id, sourceId: "project:" + p.id,
      revision: hash!, title: p.title + " 当前状态", excerpt, observedAt,
      temporalState: "CURRENT", knowledgeClass: "PROJECT_OBSERVATION", start: 0, end: excerpt.length, excerptHash: jsonHash(excerpt) });
    const search = await searchMissionMemory({ userId: actor.userId, projectId: p.id, missionId: "" }, { query: query.slice(0, 256), limit: 3 });
    for (const s of search.sources.slice(0, 3)) {
      const text = s.text.slice(0, 600);
      sources.push({ id: p.id + "/" + s.id, projectId: p.id, sourceId: s.id, revision: s.hash,
        title: s.id, excerpt: text, observedAt: s.observedAt,
        temporalState: s.temporalState ?? "UNKNOWN", knowledgeClass: s.knowledgeClass ?? "PROJECT_OBSERVATION",
        start: 0, end: text.length, excerptHash: jsonHash(text) });
    }
  }
  const orderedRefs = entityRef ? [...refs.filter(r => r.kind === entityRef.kind && r.id === entityRef.id),
    ...refs.filter(r => r.kind !== entityRef.kind || r.id !== entityRef.id)] : refs;
  return { sources: sources.slice(0, 12), refs: orderedRefs, coverage: { deepReadProjects: projects.map(p => p.id),
    policy: "STATE_AND_TITLE_SUMMARY_SEARCH", limits: { projects: 3, sources: 12 },
    complete: false, limitations: ["记忆检索只覆盖标题与摘要；无结果不表示不存在", "历史原因需要定向查看原任务事件"] } };
}
