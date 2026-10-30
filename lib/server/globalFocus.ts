import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { missionSummarySelect, presentMissionSummary } from "@/lib/mission/workspaceSummary";
import type { FocusEntry, GlobalFocus } from "@/lib/types/globalFocus";
import { parseMetricRecord } from "@/lib/mission/gaps";
import { readableRecord } from "@/lib/recordPresentation";
import {selectProjectAgentContext,type AgentCandidate} from "@/lib/projectAgentContext";
import {effectiveContinuity} from "@/lib/continuity/directiveService";
import {jsonHash} from "@/lib/mission/contracts";
import { readAnchorInbox } from "@/lib/conversation/anchorService";

const LIMIT = 6;
const waitingStates = ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED"];
export async function loadGlobalFocus(userId: string, archived = false): Promise<GlobalFocus> {
  const discussions = await readAnchorInbox(userId);
  const projectScope = { memberships: { some: { userId } }, ...(archived ? {} : { archivedAt: null }) };
  // Mission access requires both this user's ownership and the project's OWNER membership.
  const missionWhere = { ownerUserId: userId, project: { ...projectScope, memberships: { some: { userId, role: "OWNER" } } } };
  const missionEnabled = isFeatureEnabled("MISSION_ENABLED", false) && isFeatureEnabled("MISSION_UI_ENABLED", true);
  const project = { select: { id: true, title: true, archivedAt: true, deadline: true,goal:true,updatedAt:true,_count:{select:{captures:true}},memberships:{where:{userId},select:{focusMissionId:true}} } };
  const now = new Date();
  const [waiting, running, actions, reminders, records] = await Promise.all([
    missionEnabled ? Promise.all(waitingStates.map(status=>db.agentMission.findMany({ where: { ...missionWhere, status }, select: { ...missionSummarySelect, project }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }))).then(rows=>rows.flat()) : [],
    missionEnabled ? db.agentMission.findMany({ where: { ...missionWhere, status: { in: ["READY", "RUNNING"] } }, select: { ...missionSummarySelect, project }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }) : [],
    db.actionItem.findMany({ where: { project: projectScope, isSimulated: false, status: { in: ["TODO", "DOING"] } }, select: { id: true, title: true, description: true, status: true, dueAt: true, createdAt: true, project }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }),
    db.agentIntervention.findMany({ where: { NOT:{dedupeKey:{startsWith:"goal:"}}, project: projectScope, isSimulated: false, OR: [{ status: "OPEN" }, { status: "SNOOZED", snoozedUntil: { lte: now } }] }, select: { id: true, title: true, content: true, status: true,severity:true, createdAt: true, project }, orderBy: [{ severity: "desc" }, { createdAt: "desc" }, { id: "desc" }], take: LIMIT + 1 }),
    db.knowledgeCard.findMany({ where: { project: projectScope, archivedAt: null }, select: { id: true, title: true, summary: true, createdAt: true, capture: {select: {rawText: true}}, project }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4 }),
  ]);
  const common = (row: { id: string; title: string; project: { id: string; title: string; archivedAt: Date | null; deadline: Date | null } }): FocusEntry => ({ id: row.id, projectId: row.project.id, projectTitle: `${row.project.title}${row.project.archivedAt ? " · 已归档" : ""}`, title: row.title, detail: "", status: "", activity: "", activityAt: "", recordedAt: "", dueAt: "", projectDeadline: row.project.deadline?.toISOString() ?? "", recordFields: [] });
  const missions = (rows: typeof waiting) => rows.slice(0, LIMIT).map(row => {
    const summary = presentMissionSummary(row);
    return { ...common({ ...row, title: row.goal }), workState:summary.workState,actionLabel:summary.workState.actionLabel,detail: summary.attention ?? "", status: row.status, activity: summary.activity ?? "", activityAt: summary.activityAt ?? "" };
  });
  const [runningCount, actionCount, reminderCount, nextDeadline] = await Promise.all([
    missionEnabled ? db.agentMission.count({where: {...missionWhere, status: {in: ["READY", "RUNNING"]}}}) : 0,
    db.actionItem.count({where: {project: projectScope, isSimulated: false, status: {in: ["TODO", "DOING"]}}}),
    db.agentIntervention.count({where: {NOT:{dedupeKey:{startsWith:"goal:"}},project: projectScope, isSimulated: false, OR: [{status: "OPEN"}, {status: "SNOOZED", snoozedUntil: {lte: now}}]}}),
    db.project.findFirst({where: {...projectScope, deadline: {gte: now}}, select: {id: true, title: true, deadline: true}, orderBy: [{deadline: "asc"}, {id: "asc"}]}),
  ]);
  const responsive=waiting.filter(row=>presentMissionSummary(row).workState.requiresUser);
  const allIds=[...new Set([...responsive,...reminders,...actions,...waiting,...running].map(row=>row.project.id))];
  const contextIds = allIds.slice(0,12);
  const contexts = isFeatureEnabled("PROJECT_AGENT_CONTEXT_ENABLED",true)?await Promise.all(contextIds.map(async id=>{
    const projectRows=[...waiting,...running,...reminders,...actions].filter(r=>r.project.id===id),p=projectRows[0].project;
    const candidates:AgentCandidate[]=[...[...waiting,...running].filter(m=>m.project.id===id).map(m=>{
      const v=presentMissionSummary(m);return {kind:"MISSION" as const,id:m.id,status:m.status,title:m.goal,reason:v.attention??"",updatedAt:m.updatedAt.toISOString(),version:m.version,planRevision:m.planRevision,workState:v.workState,sourceChanged:(m.lastErrorJson as {code?:string}|null)?.code==="SOURCE_CHANGED",questionId:v.workState.exactQuestionRef,approvalId:v.workState.exactApprovalRef,outputRevision:v.outputRevision};
    }),...reminders.filter(r=>r.project.id===id).map(r=>({kind:"INTERVENTION" as const,id:r.id,status:r.status,title:p.deadline&&+p.deadline>Date.now()&&(r.title==="截止日期已经过去"||r.content.includes("项目已经超过截止日期"))?"核对提醒与当前截止日":r.title,reason:p.deadline&&+p.deadline>Date.now()&&(r.title==="截止日期已经过去"||r.content.includes("项目已经超过截止日期"))?`历史提醒为「${r.title}」，当前项目截止日为 ${p.deadline.toISOString().slice(0,10)}。请核对原始通知及适用阶段。`:r.content,updatedAt:r.createdAt.toISOString(),severity:r.severity})),...actions.filter(a=>a.project.id===id).map(a=>({kind:"ACTION" as const,id:a.id,status:a.status,title:a.title,reason:a.description??"查看行动要求，完成后记录实际结果。",updatedAt:a.createdAt.toISOString(),dueAt:a.dueAt?.toISOString()}))];
    const c=selectProjectAgentContext({projectId:id,projectTitle:p.title,projectGoal:p.goal,projectUpdatedAt:p.updatedAt.toISOString(),candidates,focusMissionId:candidates.some(c=>c.kind==="MISSION"&&c.id===p.memberships[0]?.focusMissionId)?p.memberships[0]?.focusMissionId:null,hasRecords:p._count.captures>0});
    const continuity=await effectiveContinuity(userId,{projectId:id});
    const boundaries=[continuity.nextBoundary,c.nextStep.workState?.nextBoundary,c.nextStep.workState?.nextCheckAt,...candidates.map(x=>x.dueAt?new Date(Date.parse(x.dueAt)-86400000).toISOString():null)].filter((v):v is string=>!!v&&Date.parse(v)>Date.now()).sort();
    return {...c,workingObjective:continuity.workingObjective,nextBoundary:boundaries[0]??null,observationHash:jsonHash({contextHash:c.observationHash,intentHash:continuity.intentHash,reusePolicyHash:continuity.reusePolicyHash})};
  }).map(p=>p.catch(()=>null))):[];
  const primaryContext = contexts.filter(c=>c!==null).sort((a,b)=>a.nextStep.priority-b.nextStep.priority || b.observedAt.localeCompare(a.observedAt) || a.projectId.localeCompare(b.projectId))[0] ?? null;
  const complete=contexts.every(c=>c!==null)&&allIds.length<=12 && waiting.length<=LIMIT && running.length<=LIMIT && actions.length<=LIMIT && reminders.length<=LIMIT;
  return { coverage:{complete,consideredProjectIds:contextIds,countsAreBounded:true},discussions, primaryContext, counts: {waiting: responsive.length, running: runningCount, actions: actionCount, reminders: reminderCount},
    nextDeadline: nextDeadline?.deadline ? {projectId: nextDeadline.id, projectTitle: nextDeadline.title, at: nextDeadline.deadline.toISOString()} : null,
    schemaVersion: 1, missionEnabled, archived, hasMore: [waiting, running, actions, reminders].some(rows => rows.length > LIMIT) || new Set([...waiting,...running,...reminders,...actions].map(row=>row.project.id)).size>LIMIT,
    waiting: missions([...responsive,...waiting.filter(row=>!presentMissionSummary(row).workState.requiresUser)]), running: missions(running),
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
