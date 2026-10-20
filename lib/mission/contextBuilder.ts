import { db } from "@/lib/db";
import type { AgentMission } from "@/lib/generated/prisma/client";
import { jsonHash } from "./contracts";
export async function buildContext(m:AgentMission){
 const [events,steps,outputs]=await Promise.all([
  db.agentMissionEvent.findMany({where:{missionId:m.id,type:{in:["INPUT","QUESTION","CONSTRAINTS_CHANGED","RESEARCH_SCOPE_CHANGED","MODEL_PROTOCOL_ERROR"]}},orderBy:{seq:"desc"},take:12}),
  db.agentMissionStep.findMany({where:{missionId:m.id},orderBy:{ordinal:"desc"},take:16}),
  db.agentMissionOutput.findMany({where:{missionId:m.id},orderBy:{revision:"desc"},take:3}),
 ]);
 const observations=steps.reverse().map(s=>({stepId:s.id,status:s.status,tool:s.toolName,callId:s.providerCallId,protocol:s.protocolJson,input:s.canonicalInputJson,observation:JSON.stringify(s.resultJson).slice(0,2000)}));
 const context={schemaVersion:1,goal:m.goal,successCriteria:m.successCriteriaJson,constraints:m.constraintsJson,constraintsVersion:m.constraintsVersion,researchScope:m.researchScopeJson,scopeRevision:m.researchScopeVersion,contextVersion:m.contextVersion,planRevision:m.planRevision,budgetUsed:m.budgetUsedJson,recentInputs:events.reverse().map(e=>({seq:e.seq,type:e.type,payload:e.payloadJson})),outputs:outputs.map(o=>({id:o.id,revision:o.revision,kind:o.kind})),observations};
 const excluded:string[]=[];while(JSON.stringify(context).length>24000&&observations.length){excluded.push(observations.shift()!.stepId);}
 if(JSON.stringify(context).length>30000)throw new Error("CONTEXT_LIMIT");
 return JSON.stringify({...context,manifest:{excludedStepIds:excluded,source:"MISSION_EVENTS_AND_STEPS",hash:jsonHash(context)}});
}
