import { afterAll, expect, test, vi } from "vitest";
const isolated=await vi.hoisted(async()=>{process.env.REPO_CI_OBSERVER_ENABLED="true";return(await import("./helpers/continuityDatabase")).continuityDatabase("ux3-branch-runtime");});
import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
async function fixture(){
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED="true";
  const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"分支观察",passwordHash:"fixture"}});
  const p=await db.project.create({data:{title:"分支观察",goal:"核对原提交",description:"隔离测试",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}});
  const c=await db.sourceConnection.create({data:{projectId:p.id,ownerUserId:user.id,repo:"hongmen/demo",ref:"main",signalKind:"COMMITS_AND_CI",cursorSha:"a".repeat(40)}});
  const m=await createMission(user.id,{projectId:p.id,requestId:"create",goal:"持续核对分支",llmContextApproved:true});
  await editContinuationPolicy(user.id,m.id,{requestId:"grant",expectedVersion:m.version,policy:{mode:"BOUNDED_INVESTIGATION",schemaVersion:1,
    expiresAt:new Date(Date.now()+86400000).toISOString(),checkEveryMinutes:15,maxModels:10,maxTools:20,maxMetadataRequests:10,
    allowedTools:["inspect_project","read_repository_ci"],connectionIds:[c.id],trackBranchHead:true}});
  await db.agentMission.update({where:{id:m.id},data:{status:"WAITING_INPUT",nextAttemptAt:null}});
  await processInvestigationDelegations();return{user,p,c,m};
}
test("真实HTTP账本派发期间数据库可写；撤权后迟到head不产生候选",async()=>{
  const {c,m}=await fixture();let arrived!:()=>void,complete!:()=>void;
  const started=new Promise<void>(r=>{arrived=r;}),barrier=new Promise<void>(r=>{complete=r;});
  const transport=vi.fn(async()=>{arrived();await barrier;return{status:200,body:{sha:"b".repeat(40)}};});
  const running=runMissionSlice({id:m.id,repository:transport});await started;
  // This write must finish while the HTTP response is still blocked.
  await db.sourceConnection.update({where:{id:c.id},data:{status:"REVOKED",revokedAt:new Date()}});
  complete();await running;
  expect(transport).toHaveBeenCalledTimes(1);expect(await db.externalSignal.count({where:{connectionId:c.id}})).toBe(0);
  expect((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).budgetUsedJson).toMatchObject({metadataRequests:1});
},20000);
test("HTTP结果未知保留原operation，恢复同一任务不换步骤重发",async()=>{
  const {m}=await fixture(),transport=vi.fn(async()=>{throw new Error("network reply unknown");});
  await runMissionSlice({id:m.id,repository:transport});
  const row=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});
  await db.agentMission.update({where:{id:m.id},data:{status:"READY",pauseReason:null,planRevision:{increment:1}}});
  await runMissionSlice({id:m.id,repository:transport});
  expect(transport).toHaveBeenCalledTimes(1);expect(row.budgetUsedJson).toMatchObject({metadataRequests:1});
});
