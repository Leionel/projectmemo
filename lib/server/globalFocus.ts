import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { missionSummarySelect, presentMissionSummary } from "@/lib/mission/workspaceSummary";
import type { FocusEntry, GlobalFocus } from "@/lib/types/globalFocus";
import { parseMetricRecord } from "@/lib/mission/gaps";
import { readableRecord } from "@/lib/recordPresentation";

const LIMIT = 6;
const waitingStates = ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED"];
export async function loadGlobalFocus(userId: string, archived = false): Promise<GlobalFocus> {
  const projectScope = { memberships: { some: { userId } }, ...(archived ? {} : { archivedAt: null }) };
  // Mission access requires both this user's ownership and the project's OWNER membership.
  const missionWhere = { ownerUserId: userId, project: { ...projectScope, memberships: { some: { userId, role: "OWNER" } } } };
  const missionEnabled = isFeatureEnabled("MISSION_ENABLED", false) && isFeatureEnabled("MISSION_UI_ENABLED", true);
  const project = { select: { id: true, title: true, archivedAt: true, deadline: true } };
  const now = new Date();
  const [waiting, running, actions, reminders, records] = await Promise.all([
    missionEnabled ? db.agentMission.findMany({ where: { ...missionWhere, status: { in: waitingStates } }, select: { ...missionSummarySelect, project }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }) : [],
    missionEnabled ? db.agentMission.findMany({ where: { ...missionWhere, status: { in: ["READY", "RUNNING"] } }, select: { ...missionSummarySelect, project }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }) : [],
    db.actionItem.findMany({ where: { project: projectScope, isSimulated: false, status: { in: ["TODO", "DOING"] } }, select: { id: true, title: true, description: true, status: true, dueAt: true, createdAt: true, project }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }),
    db.agentIntervention.findMany({ where: { project: projectScope, isSimulated: false, OR: [{ status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } }] }, select: { id: true, title: true, content: true, status: true, createdAt: true, project }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }),
    db.knowledgeCard.findMany({ where: { project: projectScope, archivedAt: null }, select: { id: true, title: true, summary: true, createdAt: true, capture: {select: {rawText: true}}, project }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4 }),
  ]);
  const common = (row: { id: string; title: string; project: { id: string; title: string; archivedAt: Date | null; deadline: Date | null } }): FocusEntry => ({ id: row.id, projectId: row.project.id, projectTitle: `${row.project.title}${row.project.archivedAt ? " · 已归档" : ""}`, title: row.title, detail: "", status: "", activity: "", activityAt: "", recordedAt: "", dueAt: "", projectDeadline: row.project.deadline?.toISOString() ?? "", recordFields: [] });
  const missions = (rows: typeof waiting) => rows.slice(0, LIMIT).map(row => {
    const summary = presentMissionSummary(row);
    return { ...common({ ...row, title: row.goal }), detail: summary.attention ?? "", status: row.status, activity: summary.activity ?? "", activityAt: summary.activityAt ?? "" };
  });
  const [waitingCount, runningCount, actionCount, reminderCount, nextDeadline] = await Promise.all([
    missionEnabled ? db.agentMission.count({where: {...missionWhere, status: {in: waitingStates}}}) : 0,
    missionEnabled ? db.agentMission.count({where: {...missionWhere, status: {in: ["READY", "RUNNING"]}}}) : 0,
    db.actionItem.count({where: {project: projectScope, isSimulated: false, status: {in: ["TODO", "DOING"]}}}),
    db.agentIntervention.count({where: {project: projectScope, isSimulated: false, OR: [{status: "OPEN"}, {status: "SNOOZED", snoozedUntil: {lte: now}}]}}),
    db.project.findFirst({where: {...projectScope, deadline: {gte: now}}, select: {id: true, title: true, deadline: true}, orderBy: [{deadline: "asc"}, {id: "asc"}]}),
  ]);
  return { counts: {waiting: waitingCount, running: runningCount, actions: actionCount, reminders: reminderCount},
    nextDeadline: nextDeadline?.deadline ? {projectId: nextDeadline.id, projectTitle: nextDeadline.title, at: nextDeadline.deadline.toISOString()} : null,
    schemaVersion: 1, missionEnabled, archived, hasMore: [waiting, running, actions, reminders].some(rows => rows.length > LIMIT),
    waiting: missions(waiting), running: missions(running),
    actions: actions.slice(0, LIMIT).map(row => ({ ...common(row), status: row.status, detail: row.description ?? "", dueAt: row.dueAt?.toISOString() ?? "" })),
    reminders: reminders.slice(0, LIMIT).map(row => ({ ...common(row), status: row.status, detail: row.content })),
    records: records.slice(0, 3).map(row => {
      const text = readableRecord(row.title, row.summary), parsed = parseMetricRecord(row.capture.rawText);
      const metric = parsed?.success && parsed.data.projectId === row.project.id ? parsed.data : null;
      return {...common({...row, title: metric ? `${metric.name} 实验记录` : text.title}), detail: text.summary, recordedAt: row.createdAt.toISOString(),
        recordFields: metric ? [{label: "指标", value: metric.name}, {label: "记录值", value: `${metric.value} ${metric.unit}`}, {label: "统计范围", value: metric.period}] : []};
    }),
  };
}
