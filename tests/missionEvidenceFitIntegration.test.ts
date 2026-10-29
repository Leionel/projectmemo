import { afterAll,beforeAll,describe,it,expect,vi } from "vitest";
const isolated=await vi.hoisted(async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),DB=(await import("better-sqlite3")).default;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pm-fit-")),file=path.join(dir,"fit.db");
 process.env.DATABASE_URL=`file:${file.replaceAll("\\","/")}`;
 Object.assign(process.env,{MISSION_ENABLED:"true",MISSION_EVENT_CONTINUATION_ENABLED:"true",MISSION_EVIDENCE_FIT_ENABLED:"true",MISSION_AUTO_CONTINUATION_ENABLED:"true",LLM_MODE:"mock"});
 const db=new DB(file);for(const name of fs.readdirSync("prisma/migrations").sort()){const sql=path.join("prisma/migrations",name,"migration.sql");if(fs.existsSync(sql))db.exec(fs.readFileSync(sql,"utf8"));}db.close();return{dir};
});
import fs from "node:fs";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { createMission,missionDetail,commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { previewContinuation,confirmContinuation,automaticallyContinueWaitingMissions } from "@/lib/mission/continuationService";
import { readProjectMaterial,scanWaitingMaterials } from "@/lib/mission/sourceSignals";
import { readMissionBack } from "@/lib/mission/readback";
import { buildContext } from "@/lib/mission/contextBuilder";
import { validateResearchOutput } from "@/lib/mission/researchOutputSchema";
import { json,jsonHash,type Choice,type Source } from "@/lib/mission/contracts";
import type { EvidenceFitRequirement,EvidenceReview } from "@/lib/types/missionEvidenceFit";
let userId:string;
const question="本项目模型A在目标设备D，2026-10推理batch=1，显存预算6GB；请补充本次测量。";
const requirement:EvidenceFitRequirement={schemaVersion:1,domain:"TECH_RESOURCE_MEASUREMENT",measurement:{name:"GPU_MEMORY",unit:"GB",upperLimit:6},checks:[
 {id:"SUBJECT",expected:"本项目模型A",basis:{kind:"QUESTION",quote:"本项目模型A"}},
 {id:"STAGE",expected:"推理",basis:{kind:"QUESTION",quote:"2026-10推理batch=1"}},
 {id:"CONDITION_1",expected:"目标设备D",basis:{kind:"QUESTION",quote:"目标设备D"}},
 {id:"CONDITION_2",expected:"batch=1",basis:{kind:"QUESTION",quote:"batch=1"}},
]};
const good="2026-10本项目模型A在目标设备D推理batch=1，运行r1，GPU内存峰值6.8GB。";
beforeAll(async()=>{userId=(await db.user.create({data:{username:"fit-owner",displayName:"隔离测试",passwordHash:"unused"}})).id;});
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
async function slice(id:string,choice:Choice){return runMissionSlice({id,provider:async()=>({choice,provider:"TEST_FIXTURE",model:"scripted",protocol:"JSON_CHOICE",usage:{inputTokens:10,outputTokens:5}})});}
async function fixture(text=good){
 const p=await db.project.create({data:{title:"证据核对隔离项目",description:"SYNTHETIC",goal:"在目标设备D演示",scenario:"RESEARCH"}});await db.projectMembership.create({data:{projectId:p.id,userId}});
 const m=await createMission(userId,{projectId:p.id,requestId:p.id,goal:"在目标设备D演示并保留测量记录",llmContextApproved:true,continuationPolicy:{mode:"LOW_RISK_READ_ANALYZE"}});
 await slice(m.id,{kind:"ask",question,missing:"PRIVATE",requirements:{terms:["显存"],unit:"GB",period:"2026-10",sourceType:"EITHER",evidenceFitV1:requirement}});
 const d=await missionDetail(userId,m.id),c=await db.capture.create({data:{projectId:p.id,rawText:text,sourceType:"实验记录"}}),source=(await readProjectMaterial(p.id,`capture:${c.id}`))!;
 const body={questionId:d.question!.id,sourcePointers:[{id:source.id,hash:source.hash}]};
 const review:EvidenceReview={schemaVersion:1,mode:"ANSWERING_EVIDENCE",note:"按原记录重评，保留现实结果未验证的边界",premiseHash:d.evidencePremise!.premiseHash,confirmedPremise:true};
 return{p,m,d,c,source,body,review};
}
async function confirm(f:Awaited<ReturnType<typeof fixture>>,mode:EvidenceReview["mode"]="ANSWERING_EVIDENCE"){
 const review={...f.review,mode},preview=await previewContinuation(userId,f.m.id,{...f.body,evidenceReview:review});
 const body={...f.body,evidenceReview:review,fitHash:preview.fitHash,requestId:crypto.randomUUID(),expectedVersion:preview.version,expectedContextVersion:preview.contextVersion,assessmentHash:preview.assessmentHash,answer:"请重评原任务，保留未知与负结果",confirmedGap:true as const};
 return{preview,body,result:await confirmContinuation(userId,f.m.id,body)};
}
describe("P2 E0原问题核对→确认→同Mission消费（mock）",()=>{
 it("预览纯读；同义有效负结果绕开字面缺词，确认原子落审阅与绑定，重试不重复",async()=>{
  const f=await fixture(),before=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}}),n=await db.agentMissionEvent.count({where:{missionId:f.m.id}});
  const preview=await previewContinuation(userId,f.m.id,{...f.body,evidenceReview:f.review});
  expect(preview).toMatchObject({assessment:"INSUFFICIENT",evidenceFit:{fitStatus:"FIT",groups:[{measurementResult:"EXCEEDS_LIMIT"}]}});
  expect(await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).toEqual(before);expect(await db.agentMissionEvent.count({where:{missionId:f.m.id}})).toBe(n);
  const {body,result}=await confirm(f);expect(result.continued).toBe(true);expect(await confirmContinuation(userId,f.m.id,body)).toEqual(result);
  expect(await db.agentMissionEvent.count({where:{missionId:f.m.id,type:"EVIDENCE_FIT_REVIEWED"}})).toBe(1);
  expect(await db.agentMissionStep.count({where:{missionId:f.m.id,toolName:"bind_project_sources"}})).toBe(1);
  const m=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}});expect(m.goal).toBe(f.m.goal);expect(m.successCriteriaJson).toEqual(f.m.successCriteriaJson);
  expect(JSON.parse(await buildContext(m)).evidenceReviews[0].groups[0].measurementResult).toBe("EXCEEDS_LIMIT");
  const readback=await readMissionBack(userId,m.id,{questionId:f.body.questionId});expect(readback.evidenceReviews.items[0]).toMatchObject({review:{mode:"ANSWERING_EVIDENCE"},fitStatus:"FIT"});
 });
 it("V2旧端不能绕过核对，错误fitHash/用途改变不能沿用旧预览",async()=>{
  const f=await fixture(),p=await previewContinuation(userId,f.m.id,f.body);
  const body={...f.body,requestId:crypto.randomUUID(),expectedVersion:p.version,expectedContextVersion:p.contextVersion,assessmentHash:p.assessmentHash,answer:"确认",confirmedGap:true};
  await expect(confirmContinuation(userId,f.m.id,body)).rejects.toMatchObject({code:"EVIDENCE_REVIEW_REQUIRED"});
  await expect(commandMission(userId,f.m.id,"input",{requestId:crypto.randomUUID(),expectedVersion:p.version,questionId:f.body.questionId,answer:"确认"})).rejects.toMatchObject({code:"EVIDENCE_REVIEW_REQUIRED"});
  const reviewed=await previewContinuation(userId,f.m.id,{...f.body,evidenceReview:f.review});
  await expect(confirmContinuation(userId,f.m.id,{...body,assessmentHash:reviewed.assessmentHash,evidenceReview:f.review,fitHash:"a".repeat(64)})).rejects.toMatchObject({code:"FIT_CHANGED"});
  expect(await db.agentMissionEvent.count({where:{missionId:f.m.id,type:"EVIDENCE_FIT_REVIEWED"}})).toBe(0);
 });
 it("错位材料可仅作背景，或保留未知继续分析；不能当直接作答",async()=>{
  const f=await fixture(good.replace("推理","训练"));
  await expect(confirm(f)).rejects.toMatchObject({code:"EVIDENCE_FIT_UNRESOLVED"});
  expect((await confirm(f,"BACKGROUND_ONLY")).result).toMatchObject({continued:false,reason:"BACKGROUND_ONLY"});
  expect((await missionDetail(userId,f.m.id)).status).toBe("WAITING_INPUT");
  expect((await confirm(f,"CONDITIONAL_ANALYSIS")).result.continued).toBe(true);
  const m=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}}),context=JSON.parse(await buildContext(m));
  expect(context.pendingQuestion.evidenceFitReview.fitStatus).toBe("NOT_FIT");expect(context.evidenceReviews[0].groups[0].checks).toContainEqual(expect.objectContaining({checkId:"STAGE",status:"MISMATCH"}));
 });
 it("文字答复和后续提问不能清除未决项；关开关不把V2降成V1",async()=>{
  const f=await fixture();process.env.MISSION_EVIDENCE_FIT_ENABLED="false";
  try{
   await commandMission(userId,f.m.id,"input",{requestId:crypto.randomUUID(),expectedVersion:f.d.version,questionId:f.body.questionId,answer:"还不知道，先列出条件",evidenceReview:{...f.review,mode:"CONDITIONAL_ANALYSIS"}});
   let m=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}});expect(JSON.parse(await buildContext(m)).pendingQuestion.evidenceFitReview.unresolvedChecks).toContain("NO_MATERIAL");
   await slice(f.m.id,{kind:"ask",question:"下一项仍需补充",missing:"PRIVATE"});
   m=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}});expect(JSON.parse(await buildContext(m)).evidenceReviews[0].unresolvedChecks).toContain("NO_MATERIAL");
  }finally{process.env.MISSION_EVIDENCE_FIT_ENABLED="true";}
 });
 it("V2不走自动标量恢复；用户粘贴论文的身份保留，不能冒充本人实验",async()=>{
  const f=await fixture('论文P报告：模型A在服务器S推理batch=1，显存峰值5.2GB。');
  await scanWaitingMaterials(30);expect(await automaticallyContinueWaitingMissions(30,[f.m.id])).toBe(0);
  await confirm(f,"CONDITIONAL_ANALYSIS");
  const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:f.m.id,toolName:"bind_project_sources"}}),source=(step.resultJson as unknown as {sources:Source[]}).sources[0];
  expect(source).toMatchObject({kind:"PROJECT",knowledgeClass:"EXTERNAL_REFERENCE"});
  const output={kind:"RESEARCH",blocks:[{blockId:"b",kind:"PROJECT_OBSERVATION",text:"本项目实测达到5.2GB",sourceIds:[source.id],citations:[]}],missingInformation:[]};
  expect(()=>validateResearchOutput(output,[source])).toThrow("外部参考或未决观察不能变成项目实测");
 });
 it("源修改/跨项目、前提版本变化均拒绝旧预览，不写半条审阅",async()=>{
  const f=await fixture(),p=await previewContinuation(userId,f.m.id,{...f.body,evidenceReview:f.review});
  await db.capture.update({where:{id:f.c.id},data:{rawText:good.replace("6.8","5.2")}});
  await expect(confirmContinuation(userId,f.m.id,{...f.body,evidenceReview:f.review,fitHash:p.fitHash,requestId:crypto.randomUUID(),expectedVersion:p.version,expectedContextVersion:p.contextVersion,assessmentHash:p.assessmentHash,answer:"确认",confirmedGap:true})).rejects.toMatchObject({code:"SOURCE_CHANGED"});
  const another=await fixture();await expect(previewContinuation(userId,f.m.id,{...f.body,sourcePointers:another.body.sourcePointers,evidenceReview:f.review})).rejects.toMatchObject({code:"SOURCE_CHANGED"});
  expect(await db.agentMissionEvent.count({where:{missionId:f.m.id,type:"EVIDENCE_FIT_REVIEWED"}})).toBe(0);
  expect(jsonHash(json(requirement))).toHaveLength(64);
 });
 it("新约束不能悄悄沿用原问题的旧条件作为已适用依据",async()=>{
  const f=await fixture();await db.agentMission.update({where:{id:f.m.id},data:{constraintsVersion:{increment:1}}});
  const d=await missionDetail(userId,f.m.id);expect(d.evidencePremise?.basisStatus).toBe("UNRESOLVED");
  await expect(previewContinuation(userId,f.m.id,{...f.body,evidenceReview:f.review})).rejects.toMatchObject({code:"FIT_PREMISE_CHANGED"});
 });
 it("展示开关关闭不绕过Ledger；旧源不能靠条件分析恢复，争议保留未知",async()=>{
  const f=await fixture();
  const old=await db.knowledgeCard.create({data:{projectId:f.p.id,captureId:f.c.id,type:"experiment_log",title:"旧测量",summary:good,keywords:[],relatedTasks:[],nextActions:[],importance:3}});
  const nextCapture=await db.capture.create({data:{projectId:f.p.id,rawText:"测量更正",sourceType:"实验记录"}});
  const fresh=await db.knowledgeCard.create({data:{projectId:f.p.id,captureId:nextCapture.id,type:"experiment_log",title:"更正测量",summary:"测量更正",keywords:[],relatedTasks:[],nextActions:[],importance:3}});
  await db.cardRelation.create({data:{currentCardId:fresh.id,relatedCardId:old.id,relationType:"SUPERSEDES",reason:"隔离更正",score:100,confirmed:true,confirmedAt:new Date(Date.now()-1000),validFrom:new Date(Date.now()-1000)}});
  const source=(await readProjectMaterial(f.p.id,f.source.id))!;f.body.sourcePointers=[{id:source.id,hash:source.hash}];
  process.env.TEMPORAL_MEMORY_ENABLED="false";
  try{await expect(confirm(f,"CONDITIONAL_ANALYSIS")).rejects.toMatchObject({code:"EVIDENCE_SOURCE_BLOCKED"});}finally{process.env.TEMPORAL_MEMORY_ENABLED="true";}
  expect((await missionDetail(userId,f.m.id)).status).toBe("WAITING_INPUT");
 });
 it("同文件不同观察按精确范围分归属；有效组不被背景组误阻塞",async()=>{
  const f=await fixture(good+"\n"+good.replace("推理","训练"));await confirm(f);
  const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:f.m.id,toolName:"bind_project_sources"}}),source=(step.resultJson as unknown as {sources:Source[]}).sources[0];
  expect(source.knowledgeClass).toBe("MIXED");expect(source.observationScopes).toHaveLength(2);
  const block=(index:number)=>{const s=source.observationScopes![index],text=source.text.slice(s.start,s.end);return{kind:"RESEARCH",blocks:[{blockId:"b",kind:"PROJECT_OBSERVATION",text,sourceIds:[source.id],citations:[{sourceId:source.id,start:s.start,end:s.end,excerptHash:createHash("sha256").update(text).digest("hex")}]}],missingInformation:[]};};
  expect(()=>validateResearchOutput(block(0),[source])).not.toThrow();
  expect(()=>validateResearchOutput(block(1),[source])).toThrow("外部参考或未决观察不能变成项目实测");
 });
 it("有效观察在正文中段时，预览和Runner都得到实际原文范围",async()=>{
  const f=await fixture("封面".repeat(2400)+"。\n"+good+"\n"+"附录".repeat(2400));
  const {preview}=await confirm(f);expect(preview.materials[0].text).not.toContain("6.8GB");expect(preview.observationExcerpts?.[0].text).toContain("6.8GB");
  const m=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}}),context=JSON.parse(await buildContext(m));
  expect(context.evidenceReviews[0].groups[0].excerpt.text).toContain("6.8GB");
  expect(context.manifest.includedEventSeqs.length).toBeGreaterThan(0);
 });
});
