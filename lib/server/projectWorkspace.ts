import {cache} from "react";
import {notFound,redirect} from "next/navigation";
import {db} from "@/lib/db";
import {getSessionUser,hasProjectAccess} from "@/lib/auth/serverSession";
import {listActions,listInterventions,getProjectMetrics} from "@/lib/repositories/agent";
import {evaluateProjectContext} from "@/lib/services/agentContextService";
import {buildProjectDashboard} from "@/lib/projectDashboard";
import type {ActionItemData,InterventionData,AgentEvidence,ProposedAction,ProjectMetrics} from "@/lib/types";

export const loadWorkspaceProject=cache(async(id:string)=>{
 const user=await getSessionUser();if(!user)return null;
 if(!(await hasProjectAccess(user.id,id)))notFound();
 const project=await db.project.findUnique({where:{id},include:{memberships:{where:{userId:user.id},select:{role:true}}}});if(!project)notFound();
 return {user,project,missionOwner:project.memberships.some(m=>m.role==="OWNER")};
});
export async function requireWorkspaceProject(id:string,section=""){
 const result=await loadWorkspaceProject(id);
 if(!result)redirect(`/login?from=${encodeURIComponent(`/projects/${id}${section?`/${section}`:""}`)}`);
 return result;
}
export const loadWorkspaceOverview=cache(async(id:string)=>{
 const {user}=await requireWorkspaceProject(id);
 await evaluateProjectContext(id,{},user.id);
 const [project,actions,interventions,metrics]=await Promise.all([
  db.project.findUniqueOrThrow({where:{id},include:{cards:{where:{archivedAt:null},orderBy:{createdAt:"desc"},select:{id:true,title:true,summary:true,type:true,importance:true,createdAt:true}},artifacts:{orderBy:{createdAt:"desc"},select:{id:true,artifactType:true,createdAt:true}},_count:{select:{captures:true,cards:true,artifacts:true}}}}),
  listActions(id),listInterventions(id,true),getProjectMetrics(id)
 ]);
 const dashboard=buildProjectDashboard({projectId:id,deadline:project.deadline,cards:project.cards.map(c=>({type:String(c.type)})),artifacts:project.artifacts.map(a=>({artifactType:String(a.artifactType)})),actions:actions.map(a=>({...a,status:String(a.status)})),interventions:interventions.map(i=>({...i,status:String(i.status),triggerType:String(i.triggerType)}))});
 return {project,actions:actions.map(toActionData),interventions:interventions.map(toInterventionData),metrics:metrics as ProjectMetrics,dashboard};
});

export function toInterventionData(item: Awaited<ReturnType<typeof listInterventions>>[number]): InterventionData {
  return {
    id: item.id,
    projectId: item.projectId,
    triggerType: String(item.triggerType) as InterventionData["triggerType"],
    dedupeKey: item.dedupeKey,
    status: String(item.status) as InterventionData["status"],
    severity: item.severity,
    title: item.title,
    content: item.content,
    evidence: item.evidence as unknown as AgentEvidence,
    proposedActions: item.proposedActions as unknown as ProposedAction[],
    isSimulated: item.isSimulated,
    snoozedUntil: item.snoozedUntil?.toISOString() ?? null,
    dismissReason: item.dismissReason,
    handledAt: item.handledAt?.toISOString() ?? null,
    evidenceCardId: item.evidenceCardId,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    actions: item.actions?.map(toActionData),
  };
}

type ActionLike = {
  id: string;
  projectId: string;
  sourceInterventionId: string | null;
  sourceCardId: string | null;
  resultCardId: string | null;
  title: string;
  description: string | null;
  priority: number;
  status: string;
  dueAt: Date | null;
  resultText: string | null;
  isSimulated: boolean;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export function toActionData(item: ActionLike): ActionItemData {
  return {
    id: item.id,
    projectId: item.projectId,
    sourceInterventionId: item.sourceInterventionId,
    sourceCardId: item.sourceCardId,
    resultCardId: item.resultCardId,
    title: item.title,
    description: item.description,
    priority: item.priority,
    status: String(item.status) as ActionItemData["status"],
    dueAt: item.dueAt?.toISOString() ?? null,
    resultText: item.resultText,
    isSimulated: item.isSimulated,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
