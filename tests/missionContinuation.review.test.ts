import {afterAll,expect,it,vi} from "vitest";
const isolated=await vi.hoisted(async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),Database=(await import("better-sqlite3")).default;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mission-continuation-review-")),file=path.join(dir,"review.db");
 process.env.DATABASE_URL=`file:${file.replaceAll("\\","/")}`;
 process.env.MISSION_ENABLED="true";process.env.MISSION_EVENT_CONTINUATION_ENABLED="true";process.env.LLM_MODE="mock";
 const sql=new Database(file);
 for(const name of fs.readdirSync("prisma/migrations").sort()){
  const p=path.join("prisma/migrations",name,"migration.sql");if(fs.existsSync(p))sql.exec(fs.readFileSync(p,"utf8"));
 }
 sql.close();return {dir};
});
import {db} from "@/lib/db";
import {createMission,missionDetail} from "@/lib/mission/missionService";
import {runMissionSlice} from "@/lib/mission/runner";
import {readProjectMaterial} from "@/lib/mission/sourceSignals";
import {previewContinuation,confirmContinuation} from "@/lib/mission/continuationService";
import {getTemporalSearchStates} from "@/lib/services/temporalLedgerService";
import fs from "node:fs";
afterAll(async()=>{await db.$disconnect();for(const name of fs.readdirSync(isolated.dir))fs.unlinkSync(`${isolated.dir}/${name}`);fs.rmdirSync(isolated.dir);});

it("已被取代的Capture即便使用最新hash，也不能补当前实验缺口并恢复",async()=>{
 const user=await db.user.create({data:{username:"continuation-review",displayName:"隔离复现",passwordHash:"unused"}});
 const project=await db.project.create({data:{title:"测试项目",goal:"核对当前实验指标",description:"隔离资料",scenario:"RESEARCH"}});
 await db.projectMembership.create({data:{userId:user.id,projectId:project.id}});
 const mission=await createMission(user.id,{projectId:project.id,requestId:project.id,goal:"补充当前本地实验Dice",llmContextApproved:true});
 await runMissionSlice({id:mission.id,provider:async()=>({choice:{kind:"ask",question:"请补充当前本地实验Dice",missing:"PRIVATE",requirements:{terms:["Dice"],unit:"",period:"",sourceType:"CAPTURE"}},provider:"TEST_FIXTURE",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:10,outputTokens:5}})});
 async function material(text:string){
  const capture=await db.capture.create({data:{projectId:project.id,rawText:text,sourceType:"USER"}});
  const card=await db.knowledgeCard.create({data:{projectId:project.id,captureId:capture.id,type:"experiment_log",title:text,summary:text,keywords:[],relatedTasks:[],nextActions:[],importance:3}});
  return {capture,card};
 }
 const old=await material("本地实验Dice为0.85"),fresh=await material("更正：本地实验Dice应为0.51");
 await db.cardRelation.create({data:{currentCardId:fresh.card.id,relatedCardId:old.card.id,relationType:"SUPERSEDES",reason:"更正旧实验结果",score:100,confirmed:true,confirmedAt:new Date(Date.now()-1000),validFrom:new Date(Date.now()-1000)}});
 const states=await getTemporalSearchStates(project.id,[old.card.id]);
 expect(states.get(old.card.id)?.topLevelState).toBe("SUPERSEDED");
 const source=await readProjectMaterial(project.id,`capture:${old.capture.id}`);
 const detail=await missionDetail(user.id,mission.id);
 const selection={questionId:detail.question!.id,sourcePointers:[{id:source!.id,hash:source!.hash}]};
 const preview=await previewContinuation(user.id,mission.id,selection);
 expect(preview.assessment).toBe("CONFLICT");
 const result=await confirmContinuation(user.id,mission.id,{...selection,requestId:"confirm-superseded",expectedVersion:preview.version,expectedContextVersion:preview.contextVersion,assessmentHash:preview.assessmentHash,answer:"以所选资料作为当前实验指标",confirmedGap:true});
 expect(result).toMatchObject({continued:false});
 expect((await missionDetail(user.id,mission.id)).status).toBe("WAITING_INPUT");
});
