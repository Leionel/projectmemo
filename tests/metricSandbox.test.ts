import { afterAll,expect,test,vi } from "vitest";
const isolated=await vi.hoisted(async()=>(await import("./helpers/continuityDatabase")).continuityDatabase("metric-job"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission,missionDetail,commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import { fakeDocker } from "./helpers/metricDockerFixture";
import { reviewMissionBudget } from "@/lib/mission/budgetReview";
import { buildContext } from "@/lib/mission/contextBuilder";
import { verifyMissionResult } from "@/lib/mission/resultVerifier";
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
const row={runId:"a",method:"A",metric:"accuracy",value:0.8,unit:"ratio",period:"2026-10-29",direction:"HIGHER_BETTER",dataset:"D@1",split:"test@1",seed:"42",evaluationCode:"eval@1",environment:"CPU@1",phase:"inference",batchSize:"1"};
async function fixture(){
 Object.assign(process.env,{EXPERIMENT_OBSERVER_ENABLED:"true",SANDBOX_VERIFICATION_ENABLED:"true"});
 const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"合成核算用户",passwordHash:"unused"}}),p=await db.project.create({data:{title:"核算",goal:"比较指标",description:"SYNTHETIC",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}}),capture=await db.capture.create({data:{projectId:p.id,rawText:JSON.stringify([row,{...row,runId:"b",method:"B",value:0.7}]),sourceType:"EXPERIMENT_METRICS"}}),sourceId="capture:"+capture.id,revision=(await sourceHash(p.id,sourceId))!;
 const m=await createMission(user.id,{projectId:p.id,requestId:"create",goal:p.goal,llmContextApproved:true});
 await runMissionSlice({id:m.id,provider:async()=>({choice:{kind:"tool",tool:"propose_metric_verification",args:{sourceId,revision,format:"JSON",leftRun:"a",rightRun:"b",metric:"accuracy"},summary:"核算预览"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 let view=await missionDetail(user.id,m.id);expect(view.status).toBe("WAITING_APPROVAL");
 const a=view.approvals[0];await commandMission(user.id,m.id,"approval",{requestId:"approve",expectedVersion:view.version,decision:"APPROVED",proposalHash:a.proposalHash},a.id);
 view=await missionDetail(user.id,m.id);return {user,p,capture,m,view};
}

test("lost start reply keeps original reservation; user resume reconciles same job with zero second create/start",async()=>{
 const f=await fixture(),docker=fakeDocker();
 await runMissionSlice({id:f.m.id,sandbox:async args=>{const value=await docker.run(args);if(args[0]==="start")throw new Error("LOST_REPLY");return value;}});
 let view=await missionDetail(f.user.id,f.m.id);expect(view.status).toBe("PAUSED");expect(view.steps[0].status).toBe("UNKNOWN");expect(view.used).toMatchObject({sandboxJobs:1});
 await commandMission(f.user.id,f.m.id,"resume",{requestId:"resume-original-job",expectedVersion:view.version});
 await runMissionSlice({id:f.m.id,sandbox:docker.run});view=await missionDetail(f.user.id,f.m.id);
 expect(view.steps[0].status).toBe("SUCCEEDED");expect(view.used).toMatchObject({sandboxJobs:1});expect(docker.calls.filter(c=>c==="create")).toHaveLength(1);expect(docker.calls.filter(c=>c==="start")).toHaveLength(1);
 expect(await db.agentMissionApproval.count({where:{missionId:f.m.id,status:"CONSUMED"}})).toBe(1);expect(await db.actionItem.count({where:{projectId:f.p.id}})).toBe(0);
});
test("lost create reply reconciles an existing never-started job, while an absent UNKNOWN job is never recreated",async()=>{
 const f=await fixture(),docker=fakeDocker();await runMissionSlice({id:f.m.id,sandbox:async args=>{const value=await docker.run(args);if(args[0]==="create")throw new Error("LOST_CREATE_REPLY");return value;}});
 let view=await missionDetail(f.user.id,f.m.id);expect(view.steps[0].status).toBe("UNKNOWN");await commandMission(f.user.id,f.m.id,"resume",{requestId:"resume-create",expectedVersion:view.version});await runMissionSlice({id:f.m.id,sandbox:docker.run});
 expect((await missionDetail(f.user.id,f.m.id)).steps[0].status).toBe("SUCCEEDED");expect(docker.calls.filter(c=>c==="create")).toHaveLength(1);expect(docker.calls.filter(c=>c==="start")).toHaveLength(1);
 const g=await fixture(),absent=fakeDocker();await runMissionSlice({id:g.m.id,sandbox:async args=>{if(args[0]==="create")throw new Error("DISPATCH_OUTCOME_UNKNOWN");return absent.run(args);}});
 view=await missionDetail(g.user.id,g.m.id);await commandMission(g.user.id,g.m.id,"resume",{requestId:"resume-missing",expectedVersion:view.version});await runMissionSlice({id:g.m.id,sandbox:absent.run});view=await missionDetail(g.user.id,g.m.id);
 expect(view.steps[0].status).toBe("UNKNOWN");expect(absent.calls).not.toContain("create");expect(absent.calls).not.toContain("start");expect(view.used).toMatchObject({sandboxJobs:1});
});
test("source correction wins preflight race before dispatch: no container and no reservation",async()=>{
 const f=await fixture(),docker=fakeDocker();
 await runMissionSlice({id:f.m.id,sandbox:async args=>{if(args[0]==="image")await db.capture.update({where:{id:f.capture.id},data:{rawText:JSON.stringify([row])}});return docker.run(args);}});
 const view=await missionDetail(f.user.id,f.m.id);expect(view.status).toBe("PAUSED");expect(docker.calls).toEqual(["image"]);expect((view.used as {sandboxJobs?:number}).sandboxJobs??0).toBe(0);expect(view.steps[0].status).toBe("OBSOLETE");
});
test("late completed receipt after source correction stays historical and never consumes approval",async()=>{
 const f=await fixture(),docker=fakeDocker();
 await runMissionSlice({id:f.m.id,sandbox:async args=>{const value=await docker.run(args);if(args[0]==="logs")await db.capture.update({where:{id:f.capture.id},data:{rawText:JSON.stringify([row])}});return value;}});
 const view=await missionDetail(f.user.id,f.m.id);expect(view.status).toBe("PAUSED");expect(view.steps[0].status).toBe("OBSOLETE");expect(view.steps[0].execution).toMatchObject({current:false,receipt:{exitCode:0}});expect(await db.agentMissionApproval.count({where:{missionId:f.m.id,status:"CONSUMED"}})).toBe(0);
});

test("budget review keeps UNKNOWN reservations and the same job; CAS and replay cannot reset usage",async()=>{
 const f=await fixture(),docker=fakeDocker();await runMissionSlice({id:f.m.id,sandbox:async args=>{const value=await docker.run(args);if(args[0]==="start")throw new Error("LOST_REPLY");return value;}});
 const before=await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}}),body={requestId:"review",expectedVersion:before.version,totals:{models:18,tools:24,activeMs:360000,reservedOutputTokens:24000}};
 const after=await reviewMissionBudget(f.user.id,f.m.id,body);expect(after.status).toBe("PAUSED");expect(after.budgetUsedJson).toEqual(before.budgetUsedJson);expect(after.leaseEpoch).toBeGreaterThan(before.leaseEpoch);expect(after.contextVersion).toBe(before.contextVersion);
 await reviewMissionBudget(f.user.id,f.m.id,body);expect(await db.agentMissionEvent.count({where:{missionId:f.m.id,type:"BUDGET_REVIEWED"}})).toBe(1);
 await expect(reviewMissionBudget(f.user.id,f.m.id,{...body,requestId:"race"})).rejects.toMatchObject({code:"MISSION_CHANGED"});
 await commandMission(f.user.id,f.m.id,"resume",{requestId:"resume-budget",expectedVersion:after.version});await runMissionSlice({id:f.m.id,sandbox:docker.run});
 expect(docker.calls.filter(x=>x==="start")).toHaveLength(1);const completed=await missionDetail(f.user.id,f.m.id);expect(completed.used).toMatchObject({sandboxJobs:1});expect(completed.steps[0].status).toBe("SUCCEEDED");
});

test("draft or action creation alone cannot satisfy result/metadata/kernel completion",async()=>{
 const f=await fixture();const m=await db.agentMission.update({where:{id:f.m.id},data:{successCriteriaJson:["DRAFT_EXISTS","ACTION_RESULT_RECORDED","PAPER_METADATA_READ","FIXED_METRIC_JOB_RECORDED"]}});
 const output=await db.agentMissionOutput.create({data:{missionId:m.id,revision:1,kind:"DRAFT",contentJson:{blocks:[]},sourceRefsJson:[],verificationStatus:"UNVERIFIED",claimChecksJson:[]}});
 await expect(verifyMissionResult(db,m,output.id)).rejects.toMatchObject({code:"CRITERIA_NOT_MET",details:{checks:expect.arrayContaining([{criterion:"ACTION_RESULT_RECORDED",passed:false},{criterion:"FIXED_METRIC_JOB_RECORDED",passed:false},{criterion:"PAPER_METADATA_READ",passed:false}])}});
});

test("completed action pointer replaces creation-time TODO in current context",async()=>{
 const f=await fixture();const action=await db.actionItem.create({data:{projectId:f.p.id,title:"复核",status:"DONE",isSimulated:false}});
 const approval=await db.agentMissionApproval.findFirstOrThrow({where:{missionId:f.m.id}});await db.agentMissionStep.update({where:{id:approval.stepId},data:{resultJson:{data:{actionId:action.id,status:"TODO"},sources:[]}}});await db.agentMissionApproval.update({where:{id:approval.id},data:{status:"CONSUMED"}});
 const context=await buildContext(await db.agentMission.findUniqueOrThrow({where:{id:f.m.id}}));expect(context).toBeDefined();
 expect(JSON.parse(context).actionReadbacks).toEqual(expect.arrayContaining([expect.objectContaining({reportedState:"DONE",actionId:action.id})]));
});
