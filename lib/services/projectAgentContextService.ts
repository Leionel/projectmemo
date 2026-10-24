import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { selectProjectAgentContext, type AgentCandidate } from "@/lib/projectAgentContext";
import { missionSummarySelect, presentMissionSummary } from "@/lib/mission/workspaceSummary";

export async function getProjectAgentContext(userId: string, projectId: string) {
  const project = await db.project.findFirst({where:{id:projectId,memberships:{some:{userId}}},select:{id:true,title:true,goal:true,updatedAt:true,_count:{select:{captures:true}},memberships:{where:{userId},select:{role:true,focusMissionId:true}}}});
  if (!project) throw new AppError("PROJECT_NOT_FOUND","项目不存在或无法访问",404);
  if (!isFeatureEnabled("PROJECT_AGENT_CONTEXT_ENABLED",true)) return null;
  const failures: string[] = [], candidates: AgentCandidate[] = [];
  const member = project.memberships[0];
  const enabled = member?.role === "OWNER" && isFeatureEnabled("MISSION_ENABLED",false) && isFeatureEnabled("MISSION_UI_ENABLED",true);
  // One candidate per lifecycle state plus the user's focus: bounded independently of project size.
  if (enabled) {
    const rows = (await Promise.all(["WAITING_INPUT","WAITING_APPROVAL","PAUSED","FAILED","RUNNING","READY"].map(status =>
      db.agentMission.findFirst({where:{projectId,ownerUserId:userId,status},select:{...missionSummarySelect,updatedAt:true,planRevision:true},orderBy:[{updatedAt:"desc"},{id:"asc"}]})))
      .catch(() => {failures.push("MISSION_SUMMARY_UNAVAILABLE");return [];})).filter(row=>row!==null);
    if (member.focusMissionId) {
      const focused = await db.agentMission.findFirst({where:{id:member.focusMissionId,projectId,ownerUserId:userId,status:{notIn:["SUCCEEDED","CANCELLED"]}},select:{...missionSummarySelect,updatedAt:true,planRevision:true}})
        .catch(() => {failures.push("FOCUS_MISSION_UNAVAILABLE");return null;});
      if (focused) rows.push(focused);
    }
    for (const row of rows) if(row && !candidates.some(c=>c.id===row.id)) {
      const summary = presentMissionSummary(row), error = row.lastErrorJson as {code?:string} | null;
      candidates.push({kind:"MISSION",id:row.id,status:row.status,title:row.goal,reason:summary.attention ?? summary.activity ?? (row.status==="RUNNING"?"忆程正在执行，步骤与草稿保留在原委托中。":"委托已就绪，可查看原任务和执行记录。"),updatedAt:row.updatedAt.toISOString(),version:row.version,planRevision:row.planRevision,questionId:row.events[0]?.id,approvalId:row.approvals[0]?.id,outputRevision:summary.outputRevision,sourceChanged:error?.code==="SOURCE_CHANGED"});
    }
  }
  await Promise.all([
    db.agentIntervention.findFirst({where:{projectId,isSimulated:false,OR:[{status:"OPEN"},{status:"SNOOZED",snoozedUntil:{lte:new Date()}}]},orderBy:[{severity:"desc"},{createdAt:"desc"},{id:"asc"}]}).then(row=>{if(row)candidates.push({kind:"INTERVENTION",id:row.id,status:row.status,title:row.title,reason:row.content,severity:row.severity,updatedAt:row.updatedAt.toISOString()});}).catch(()=>{failures.push("REMINDER_SUMMARY_UNAVAILABLE");}),
    db.actionItem.findFirst({where:{projectId,isSimulated:false,status:{in:["TODO","DOING"]}},orderBy:[{priority:"desc"},{createdAt:"desc"},{id:"asc"}]}).then(row=>{if(row)candidates.push({kind:"ACTION",id:row.id,status:row.status,title:row.title,reason:row.description ?? "查看行动要求，完成后记录实际结果。",updatedAt:row.updatedAt.toISOString()});}).catch(()=>{failures.push("ACTION_SUMMARY_UNAVAILABLE");}),
  ]);
  const focusMissionId = candidates.some(c=>c.kind==="MISSION"&&c.id===member.focusMissionId) ? member.focusMissionId : null;
  return selectProjectAgentContext({projectId,projectTitle:project.title,projectGoal:project.goal,projectUpdatedAt:project.updatedAt.toISOString(),candidates,focusMissionId,failures:failures.sort(),hasRecords:project._count.captures>0});
}

export async function setProjectAgentFocus(userId:string,projectId:string,missionId:string|null) {
  await db.$transaction(async tx=>{
    const member=await tx.projectMembership.findUnique({where:{userId_projectId:{userId,projectId}}});
    if(member?.role!=="OWNER")throw new AppError("PROJECT_NOT_FOUND","项目不存在或无法访问",404);
    if(missionId && !await tx.agentMission.findFirst({where:{id:missionId,projectId,ownerUserId:userId,status:{notIn:["SUCCEEDED","CANCELLED"]}}}))throw new AppError("MISSION_NOT_FOUND","请选择本项目尚未结束的委托",404);
    await tx.projectMembership.update({where:{id:member.id},data:{focusMissionId:missionId}});
  });
  return getProjectAgentContext(userId,projectId);
}
