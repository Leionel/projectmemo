import {E2E_ENV,E2E_DATABASE_URL} from "./e2e-env";
import {fakeDocker} from "../tests/helpers/metricDockerFixture";
if(process.env.DATABASE_URL!==E2E_DATABASE_URL)throw new Error("CT56 fixture requires isolated E2E database");Object.assign(process.env,E2E_ENV,{MISSION_WEB_ENABLED:"true"});
const {db}=await import("../lib/db"),[op,id]=process.argv.slice(2),{createMission}=await import("../lib/mission/missionService"),{runMissionSlice}=await import("../lib/mission/runner"),{sourceHash}=await import("../lib/mission/repository");
const row={runId:"a",method:"A",metric:"accuracy",value:0.8,unit:"ratio",period:"2026-10-29",direction:"HIGHER_BETTER",dataset:"D@1",split:"test@1",seed:"42",evaluationCode:"eval@1",environment:"CPU@1",phase:"inference",batchSize:"1"};
try{
 if(op==="create"){
  const p=await db.project.create({data:{title:"指标与论文链路验收",description:"CT56_E2E_SYNTHETIC",goal:"核对下降结果",scenario:"RESEARCH",memberships:{create:{userId:id}}}}),{processAttachmentUpload}=await import("../lib/services/attachmentService");
  const uploaded=await processAttachmentUpload({projectId:p.id,fileName:"metrics.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify([row,{...row,runId:"b",value:0.7}]))});
  const attachmentId=uploaded.attachment.id,m=await createMission(id,{projectId:p.id,requestId:"ct56-ui",goal:p.goal,llmContextApproved:true,researchScope:{enabled:true,academicMetadata:true,topic:"公开论文",publicTerms:["U-Net"],allowedCategories:["PUBLIC_TOPIC","PUBLIC_SOURCE"]}});
  const {observation,persistObservations}=await import("../lib/research/sourceRepository"),parent=observation(m.id,"https://doi.org/10.1007/978-3-319-24574-4_28","SEARCH_SNIPPET","公开DOI定位","U-Net DOI locator",null,1);await persistObservations(db,m.id,{observations:[parent]});
  const provider=(tool:string,args:unknown)=>async()=>({choice:{kind:"tool" as const,tool,args,summary:"合成界面验收"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}});
  await runMissionSlice({id:m.id,provider:provider("read_paper_metadata",{sourceId:parent.id,revision:parent.normalizedContentHash,scopeRevision:1}),academic:async()=>Response.json({message:{DOI:"10.1007/978-3-319-24574-4_28",title:["U-Net"],type:"proceedings-article",published:{"date-parts":[[2015]]}}})});
  const sourceId="attachment:"+attachmentId,revision=(await sourceHash(p.id,sourceId))!;
  await runMissionSlice({id:m.id,provider:provider("propose_metric_verification",{sourceId,revision,format:"JSON",leftRun:"a",rightRun:"b",metric:"accuracy"})});
  console.log(JSON.stringify({projectId:p.id,missionId:m.id,attachmentId}));
 }else{
  const p=await db.project.findFirstOrThrow({where:{id,description:"CT56_E2E_SYNTHETIC"}});
  if(op==="execute"){const m=await db.agentMission.findFirstOrThrow({where:{projectId:p.id}});await runMissionSlice({id:m.id,sandbox:fakeDocker().run});}
  else if(op==="revoke"){const m=await db.agentMission.findFirstOrThrow({where:{projectId:p.id}}),{editMission}=await import("../lib/mission/missionService");await editMission(m.ownerUserId,m.id,"research-scope",{requestId:"revoke-metadata",expectedVersion:m.version,expectedScopeVersion:m.researchScopeVersion,scope:{...m.researchScopeJson as object,academicMetadata:false}});}
  else if(op==="correct"){const a=await db.attachment.findFirstOrThrow({where:{projectId:p.id}}),{correctMetricAttachmentText}=await import("../lib/services/attachmentService");await correctMetricAttachmentText(p.id,a.id,JSON.stringify([row]),a.extractedText);}
  else if(op==="remove"){const attachments=await db.attachment.findMany({where:{projectId:p.id}});await db.project.delete({where:{id:p.id}});const {deleteAttachmentFile}=await import("../lib/storage/attachmentStorage");for(const a of attachments)await deleteAttachmentFile(a.storageKey);}
  else throw new Error("Expected create/execute/correct/remove");
 }
}finally{await db.$disconnect();}
