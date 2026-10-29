import { E2E_ENV,E2E_DATABASE_URL } from "./e2e-env";
import { documentPdfFixture } from "../tests/helpers/documentPdf";
if(process.env.DATABASE_URL!==E2E_DATABASE_URL)throw new Error("Document fixture requires isolated E2E database");Object.assign(process.env,E2E_ENV);
const {db}=await import("../lib/db"),[operation,value]=process.argv.slice(2);
try{
 if(operation==="create"){
  const project=await db.project.create({data:{title:"文档原页验收",description:"DOCUMENT_E2E_SYNTHETIC",goal:"核对当前条款与旧附录",scenario:"COMPETITION",memberships:{create:{userId:value}}}}),{saveFileToStorage}=await import("../lib/storage/attachmentStorage"),buffer=documentPdfFixture(),stored=await saveFileToStorage(project.id,"rules.pdf",buffer);
  const attachment=await db.attachment.create({data:{projectId:project.id,type:"PDF",fileName:"rules.pdf",mimeType:"application/pdf",storageKey:stored.storageKey,size:stored.size,sha256:stored.sha256,extractionStatus:"SUCCESS",extractedText:"Requirements 2026\fAppendix 2025",revisions:{create:{revisionIndex:0,source:"EXTRACTION",text:"Requirements 2026\fAppendix 2025"}}}});
  const {createMission}=await import("../lib/mission/missionService"),{runMissionSlice}=await import("../lib/mission/runner"),{sourceHash}=await import("../lib/mission/repository"),m=await createMission(value,{projectId:project.id,requestId:"doc",goal:"核对原文件第二页的旧附录",llmContextApproved:true}),sourceId="attachment:"+attachment.id,revision=(await sourceHash(project.id,sourceId))!;
  await runMissionSlice({id:m.id,provider:async()=>({choice:{kind:"tool",tool:"read_document_page",args:{sourceId,revision,page:2},summary:"查看原页"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
  const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:m.id}});if(step.status!=="SUCCEEDED")throw new Error("DOCUMENT_E2E_READ_FAILED");console.log(JSON.stringify({projectId:project.id,attachmentId:attachment.id,missionId:m.id}));
 }else if(operation==="correct"){
  const a=await db.attachment.findFirstOrThrow({where:{projectId:value,project:{description:"DOCUMENT_E2E_SYNTHETIC"}}});await db.attachmentRevision.create({data:{attachmentId:a.id,revisionIndex:1,text:"1 Corrected requirements",source:"USER_CORRECTION"}});
 }else if(operation==="remove"){
  const p=await db.project.findFirstOrThrow({where:{id:value,description:"DOCUMENT_E2E_SYNTHETIC"}}),attachments=await db.attachment.findMany({where:{projectId:p.id}});await db.project.delete({where:{id:p.id}});const {deleteAttachmentFile}=await import("../lib/storage/attachmentStorage");for(const a of attachments)await deleteAttachmentFile(a.storageKey);
 }else throw new Error("Expected create/correct/remove");
}finally{await db.$disconnect();}
