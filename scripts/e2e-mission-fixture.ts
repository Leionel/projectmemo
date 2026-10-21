import {E2E_DATABASE_URL,E2E_ENV,E2E_USERNAME} from "./e2e-env";
if(process.env.DATABASE_URL!==E2E_DATABASE_URL)throw new Error("Mission E2E fixture只能使用隔离数据库");
Object.assign(process.env,E2E_ENV);
const [operation,id,rawChoice]=process.argv.slice(2);
const{db}=await import("../lib/db");
try{
 const mission=await db.agentMission.findUniqueOrThrow({where:{id},include:{owner:true}});
 if(mission.owner.username!==E2E_USERNAME)throw new Error("只允许E2E测试身份的委托");
 if(operation==="slice"){
  const{runMissionSlice}=await import("../lib/mission/runner"),{choiceSchema}=await import("../lib/mission/contracts");const choice=choiceSchema.parse(JSON.parse(rawChoice));
  await runMissionSlice({id,provider:async()=>({choice,provider:"E2E_TEST_FIXTURE",model:"scripted",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 }else if(operation==="scan"){
  const{processMaterialContinuationBatch}=await import("../lib/mission/continuationService");await processMaterialContinuationBatch(100);
 }else if(operation!=="state")throw new Error("不支持的E2E fixture命令");
 const current=await db.agentMission.findUniqueOrThrow({where:{id}});
 const[events,steps,actions,approvals,receipt]=await Promise.all([db.agentMissionEvent.findMany({where:{missionId:id},select:{type:true}}),db.agentMissionStep.findMany({where:{missionId:id},select:{toolName:true,resultJson:true}}),db.actionItem.findMany({where:{projectId:mission.projectId},select:{title:true,status:true}}),db.agentMissionApproval.findMany({where:{missionId:id},select:{status:true}}),db.missionArtifactReceipt.findFirst({where:{missionId:id},select:{artifactId:true,outputId:true}})]);
 process.stdout.write(JSON.stringify({status:current.status,events,steps,actions,approvals,receipt}));
}finally{await db.$disconnect();}
