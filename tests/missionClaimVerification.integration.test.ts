import {vi,beforeAll,afterAll,describe,it,expect} from "vitest";
const isolated=await vi.hoisted(async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),Database=(await import("better-sqlite3")).default;const dir=fs.mkdtempSync(path.join(os.tmpdir(),"projectmemo-claim-integration-")),file=path.join(dir,"runtime.db");process.env.DATABASE_URL=`file:${file.replaceAll("\\","/")}`;process.env.MISSION_ENABLED="true";process.env.MISSION_SEMANTIC_CHECK_ENABLED="true";process.env.MISSION_ARTIFACT_ADOPTION_ENABLED="true";process.env.MISSION_EVENT_CONTINUATION_ENABLED="true";process.env.LLM_MODE="mock";
 const sql=new Database(file);for(const d of fs.readdirSync("prisma/migrations").sort()){const p=path.join("prisma/migrations",d,"migration.sql");if(fs.existsSync(p))sql.exec(fs.readFileSync(p,"utf8"));}sql.close();return{dir};
});
import {db} from "@/lib/db";
import {createMission,missionDetail} from "@/lib/mission/missionService";
import {runMissionSlice} from "@/lib/mission/runner";
import {projectTools} from "@/lib/mission/tools";
import {textHash} from "@/lib/research/sourceRepository";
import {usageOf,json,type Choice,type Source} from "@/lib/mission/contracts";
import type {ClaimJudge} from "@/lib/mission/claimVerifier";
import fs from "node:fs";
let userId:string;
beforeAll(async()=>{userId=(await db.user.create({data:{username:`claim-${Date.now()}`,displayName:"隔离",passwordHash:"unused"}})).id;});
afterAll(async()=>{await db.$disconnect();for(const name of fs.readdirSync(isolated.dir))fs.unlinkSync(`${isolated.dir}/${name}`);fs.rmdirSync(isolated.dir);});
const decision=(choice:Choice)=>async()=>({choice,provider:"TEST_FIXTURE",model:"scripted",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}});
async function fixture(){
 const p=await db.project.create({data:{title:"私有项目",goal:"PRIVATE_DO_NOT_SEND",description:"隔离",scenario:"RESEARCH"}});await db.projectMembership.create({data:{userId,projectId:p.id}});const m=await createMission(userId,{projectId:p.id,requestId:p.id,goal:"PRIVATE_DO_NOT_SEND，准备汇报",llmContextApproved:true});
 const text="公开模型在数据集A上Dice为0.85。",hash=textHash(text),id=`source-${m.id}`;
 const source:Source={id,kind:"EXTERNAL",entityType:"EXTERNAL_SOURCE",hash,revision:hash,text,observedAt:new Date().toISOString()};await db.externalSource.create({data:{id,missionId:m.id,requestedUrl:"https://example.org/paper",retrievalMode:"PROVIDER_EXTRACT",title:"公开来源",normalizedContentHash:hash,excerptJson:{text}}});
 const tools={...projectTools,read_fixture:{description:"隔离读取",schema:projectTools.inspect_project.schema,effects:{businessWrite:false,cacheWrite:false,externalDisclosure:false},run:async()=>({data:{},sources:[source]})}};
 await runMissionSlice({id:m.id,tools,provider:decision({kind:"tool",tool:"read_fixture",args:{},summary:"读取"})});
 const choice:Choice={kind:"tool",tool:"save_mission_output",args:{kind:"RESEARCH",blocks:[{blockId:"c",kind:"EXTERNAL_REFERENCE",text:"公开模型在数据集A上Dice为0.85。",sourceIds:[id],citations:[{sourceId:id,start:0,end:text.length,excerptHash:hash}]}]},summary:"生成"};
 return{p,m,source,choice};
}
const judge:ClaimJudge=async request=>{expect(JSON.stringify(request)).not.toContain("PRIVATE_DO_NOT_SEND");return{verdict:"ENTAILS",provider:"TEST_FIXTURE",model:"judge-fixture",usage:{inputTokens:8,outputTokens:2}};};
describe("Judge同预算持久回执",()=>{
 it("Judge计入同一模型预算，Output保存判断与来源hash，归入不改变事实",async()=>{const f=await fixture();const before=usageOf((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).budgetUsedJson);await runMissionSlice({id:f.m.id,provider:decision(f.choice),judge});const d=await missionDetail(userId,f.m.id);expect(d.outputs).toHaveLength(1);expect(d.outputs[0].claimChecksJson).toMatchObject([{blockId:"c",status:"ENTAILS",mode:"JUDGE",provider:"TEST_FIXTURE",sourceRefs:[{id:f.source.id,hash:f.source.hash}]}]);expect(d.outputs[0].verificationStatus).toBe("NEEDS_REVIEW");const used=usageOf((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).budgetUsedJson);expect(used.models-before.models).toBe(2);expect(used.unknownCalls).toBe(0);expect(await db.knowledgeCard.count({where:{projectId:f.p.id}})).toBe(0);expect(await db.agentRun.count({where:{projectId:f.p.id,provider:"TEST_FIXTURE",status:"SUCCESS"}})).toBeGreaterThan(1);});
 it("Judge失败保留草稿并标未核验，未知usage不写零成本",async()=>{const f=await fixture();await runMissionSlice({id:f.m.id,provider:decision(f.choice),judge:async()=>{throw new Error("timeout");}});const d=await missionDetail(userId,f.m.id);expect(d.outputs).toHaveLength(1);expect(d.outputs[0].claimChecksJson).toMatchObject([{status:"NOT_CHECKED",reasonCode:"JUDGE_UNAVAILABLE"}]);expect(usageOf((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).budgetUsedJson).unknownCalls).toBe(1);});
 it("Judge预算不足不调用、不扩预算，草稿保留未核验",async()=>{const f=await fixture();await db.agentMission.update({where:{id:f.m.id},data:{budgetUsedJson:json({...usageOf({}),models:11})}});const spy=vi.fn(judge);await runMissionSlice({id:f.m.id,provider:decision(f.choice),judge:spy});expect(spy).not.toHaveBeenCalled();expect((await missionDetail(userId,f.m.id)).outputs).toHaveLength(1);expect(usageOf((await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}})).budgetUsedJson).models).toBe(12);});
 it("核验期间来源变化或用户取消，旧片段不能提交Output",async()=>{for(const mode of ["source","cancel"]){const f=await fixture();const changing:ClaimJudge=async request=>{if(mode==="source")await db.externalSource.update({where:{id:f.source.id},data:{availability:"SUPERSEDED"}});else await db.agentMission.update({where:{id:f.m.id},data:{cancelRequestedAt:new Date()}});return judge(request);};await runMissionSlice({id:f.m.id,provider:decision(f.choice),judge:changing});expect((await missionDetail(userId,f.m.id)).outputs).toHaveLength(0);}});
 it("语义开关关闭，不调用Judge且不显示支持",async()=>{const f=await fixture();process.env.MISSION_SEMANTIC_CHECK_ENABLED="false";const spy=vi.fn(judge);try{await runMissionSlice({id:f.m.id,provider:decision(f.choice),judge:spy});expect(spy).not.toHaveBeenCalled();expect((await missionDetail(userId,f.m.id)).outputs[0].claimChecksJson).toMatchObject([{status:"NOT_CHECKED"}]);}finally{process.env.MISSION_SEMANTIC_CHECK_ENABLED="true";}});
});
