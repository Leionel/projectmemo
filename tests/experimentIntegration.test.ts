import { afterAll,expect,test,vi } from "vitest";
const isolated=await vi.hoisted(async()=>(await import("./helpers/continuityDatabase")).continuityDatabase("experiment-files"));
import fs from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { processAttachmentUpload,correctMetricAttachmentText } from "@/lib/services/attachmentService";
import { readExperiment } from "@/lib/experiments/reader";
import { sourceHash } from "@/lib/mission/repository";
import { discoverMaterialPointers,readWorkspaceTool } from "@/lib/conversation/toolAdapter";
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
const record={runId:"a",method:"A",metric:"accuracy",value:0.8,unit:"ratio",period:"2026-10-29",direction:"HIGHER_BETTER",dataset:"dataset@1",split:"test@1",seed:"42",evaluationCode:"eval@1",environment:"cpu@1",phase:"inference",batchSize:"1"};
test("metric upload uses original storage/revisions without model or automatic memory, shared Conversation reader detects correction",async()=>{
 process.env.EXPERIMENT_OBSERVER_ENABLED="true";process.env.ATTACHMENT_DIR=path.join(isolated.dir,"storage");
 const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"合成指标用户",passwordHash:"unused"}}),project=await db.project.create({data:{title:"同条件核对",goal:"比较原实验",description:"SYNTHETIC",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}}),actor={userId:user.id,sessionId:(await createSession(user.id)).session.id};
 const spy=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{throw new Error("NO_OUTBOUND_ALLOWED");});
 try{
  const result=await processAttachmentUpload({projectId:project.id,fileName:"metrics.json",mimeType:"text/html",buffer:Buffer.from(JSON.stringify([record,{...record,runId:"b",method:"B",value:0.7}]))});
  expect(result.attachment.type).toBe("JSON");expect(result.attachment.mimeType).toBe("application/json");expect(result.card).toBeNull();expect(await db.knowledgeCard.count({where:{projectId:project.id}})).toBe(0);
  const sourceId="attachment:"+result.attachment.id,revision=(await sourceHash(project.id,sourceId))!,call={tool:"compare_experiment_metrics" as const,projectId:project.id,sourceId,revision,format:"JSON" as const,leftRun:"a",rightRun:"b",metric:"accuracy"};
  const pointers=await discoverMaterialPointers(actor,[project.id],[]);expect(pointers.some(p=>p.sourceId===sourceId)).toBe(true);
  const read=await readWorkspaceTool(actor,call,[project.id],pointers,[]);expect(read.data).toMatchObject({comparison:{improvement:"REGRESSED"},execution:"NO_JOB_EXECUTED"});expect(read.sources[0].excerpt).toContain('"value":0.7');
  const before=result.attachment.extractedText;const corrected=await correctMetricAttachmentText(project.id,result.attachment.id,JSON.stringify([record,{...record,runId:"b",method:"B",value:0.9}]),before);expect(corrected.card).toBeNull();expect((await correctMetricAttachmentText(project.id,result.attachment.id,corrected.attachment.extractedText!,before)).idempotentReplay).toBe(true);
  await expect(readExperiment(actor,call)).rejects.toMatchObject({code:"SOURCE_CHANGED"});expect(await db.attachmentRevision.count({where:{attachmentId:result.attachment.id}})).toBe(2);
  expect(await db.knowledgeCard.count({where:{projectId:project.id}})).toBe(0);expect(spy).not.toHaveBeenCalled();
 }finally{spy.mockRestore();}
});
test("raw CSV columns can be inspected and mapped across two original files, missing conditions remain unknown",async()=>{
 process.env.EXPERIMENT_OBSERVER_ENABLED="true";process.env.ATTACHMENT_DIR=path.join(isolated.dir,"storage");
 const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"原表用户",passwordHash:"unused"}}),project=await db.project.create({data:{title:"原CSV",goal:"核对同条件",description:"SYNTHETIC",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}}),actor={userId:user.id,sessionId:(await createSession(user.id)).session.id};
 const upload=async(name:string,value:number)=>processAttachmentUpload({projectId:project.id,fileName:name+".csv",mimeType:"text/csv",buffer:Buffer.from(`run,accuracy,split\n${name},${value},test\n`)});
 const a=await upload("baseline",0.8),b=await upload("candidate",0.9),sourceId="attachment:"+a.attachment.id,revision=(await sourceHash(project.id,sourceId))!,rightId="attachment:"+b.attachment.id,rightRevision=(await sourceHash(project.id,rightId))!;
 const index=await readExperiment(actor,{tool:"inspect_experiment_metrics",projectId:project.id,sourceId,revision,format:"CSV"});expect(index.data).toMatchObject({mappingRequired:true,columns:["run","accuracy","split"]});
 const mapping={runId:"run",value:"accuracy",split:"split"},result=await readExperiment(actor,{tool:"compare_experiment_metrics",projectId:project.id,sourceId,revision,format:"CSV",mapping,rightSource:{sourceId:rightId,revision:rightRevision,format:"CSV",mapping},leftRun:"baseline",rightRun:"candidate",metric:"accuracy"});
 expect(result.sources).toHaveLength(2);expect(result.data).toMatchObject({comparison:{state:"NOT_COMPARABLE",delta:null,unknown:expect.arrayContaining(["unit","period","direction","seed"])} });
 await expect(readExperiment(actor,{tool:"compare_experiment_metrics",projectId:project.id,sourceId,revision,format:"CSV",mapping:{runId:"run",value:"invented"},leftRun:"baseline",rightRun:"candidate",metric:"accuracy"})).rejects.toMatchObject({code:"METRIC_MAPPING_INVALID"});
});
