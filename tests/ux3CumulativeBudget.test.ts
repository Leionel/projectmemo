import {afterAll,expect,test,vi} from "vitest";
const isolated=await vi.hoisted(async()=>{
  process.env.REPO_CI_OBSERVER_ENABLED="true";
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED="true";
  return (await import("./helpers/continuityDatabase")).continuityDatabase("ux3-cumulative-budget");
});
import fs from "node:fs";
import {db} from "@/lib/db";
import {createMission,editContinuationPolicy,commandMission} from "@/lib/mission/missionService";
import {reviewMissionBudget} from "@/lib/mission/budgetReview";
import {claimMission,reserve,type Lease} from "@/lib/mission/runtimeStore";
import {readMissionResponsibility} from "@/lib/mission/responsibility";
import {processInvestigationDelegations} from "@/lib/mission/investigationDelegation";
import {runMissionSlice} from "@/lib/mission/runner";
import {nextBudgetDay} from "@/lib/mission/dailyBoundary";
import {record} from "@/lib/conversation/repository";
afterAll(async()=>{vi.useRealTimers();await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
async function fixture(daily=false){
  const u=await db.user.create({data:{username:crypto.randomUUID(),displayName:"预算核对",passwordHash:"fixture"}});
  const p=await db.project.create({data:{title:"预算核对",goal:"三日持续观察",description:"隔离测试",scenario:"RESEARCH",memberships:{create:{userId:u.id}}}});
  const c=await db.sourceConnection.create({data:{ownerUserId:u.id,projectId:p.id,repo:"hongmen/demo",ref:"main",signalKind:"COMMITS_AND_CI"}});
  const m=await createMission(u.id,{requestId:"create",projectId:p.id,goal:"持续核对原仓库",llmContextApproved:true});
  await editContinuationPolicy(u.id,m.id,{requestId:"grant",expectedVersion:m.version,policy:{mode:"BOUNDED_INVESTIGATION",schemaVersion:1,
    expiresAt:new Date(Date.now()+3*86400000).toISOString(),checkEveryMinutes:15,maxModels:100,maxTools:200,maxMetadataRequests:50,
    allowedTools:["inspect_project","read_repository_ci"],connectionIds:[c.id],trackBranchHead:true,timezone:"Asia/Shanghai",
    ...(daily?{dailyBurst:{maxModels:1,maxTools:1}}:{})}});
  return{u,m,c};
}
function lease(m:NonNullable<Awaited<ReturnType<typeof claimMission>>>):Lease{return{id:m.id,owner:m.leaseOwner!,epoch:m.leaseEpoch,contextVersion:m.contextVersion,planRevision:m.planRevision};}
test("调查许可不能提高原预算；显式复核累计上限不清空UNKNOWN或偷偷恢复",async()=>{
  const {u,m}=await fixture();
  await db.agentMission.update({where:{id:m.id},data:{budgetUsedJson:{tools:16,models:12,unknownCalls:2}}});
  const claimed=await claimMission("budget-probe",m.id);
  await expect(reserve(lease(claimed!),"tools","inspect_project")).rejects.toMatchObject({code:"BUDGET_EXHAUSTED"});
  const view=await readMissionResponsibility(u.id,m.id);
  expect(view.budget.limits).toMatchObject({models:12,tools:16,metadataRequests:24});
  const paused=await db.agentMission.update({where:{id:m.id},data:{status:"PAUSED",executionSlot:null,leaseOwner:null,leaseUntil:null}});
  const reviewed=await reviewMissionBudget(u.id,m.id,{requestId:"review",expectedVersion:paused.version,totals:{models:30,tools:72,activeMs:1200000,reservedOutputTokens:60000}});
  expect(reviewed.status).toBe("PAUSED");expect(reviewed.budgetUsedJson).toMatchObject({tools:16,models:12,unknownCalls:2});
  expect((await readMissionResponsibility(u.id,m.id)).budget.limits).toMatchObject({models:30,tools:72,metadataRequests:24});
});
test("每日上限等待本地次日；恢复保留累计账本，STOP不会随日期越界解除",async()=>{
  const {u,m}=await fixture(true),now=Date.now();
  const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Shanghai"}).format(new Date(now));
  await db.agentMission.update({where:{id:m.id},data:{status:"WAITING_INPUT",nextAttemptAt:null,budgetUsedJson:{tools:1,models:0,dailyUsage:{date:today,tools:1,models:0}}}});
  await processInvestigationDelegations();
  const transport=vi.fn(async()=>({status:200,body:{sha:"b".repeat(40)}}));
  await runMissionSlice({id:m.id,repository:transport});
  const waiting=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});
  expect(waiting.status).toBe("READY");expect(waiting.nextAttemptAt).toBeTruthy();expect(transport).not.toHaveBeenCalled();
  expect(+waiting.nextAttemptAt!).toBeGreaterThan(now);
  vi.setSystemTime(+waiting.nextAttemptAt!+1000);
  await runMissionSlice({id:m.id,repository:transport});
  expect(transport).toHaveBeenCalledTimes(1);
  const resumed=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});
  expect(record(resumed.budgetUsedJson)).toMatchObject({tools:2,metadataRequests:1,dailyUsage:{tools:1}});
  await commandMission(u.id,m.id,"pause",{requestId:"stop",expectedVersion:resumed.version});
  vi.setSystemTime(+waiting.nextAttemptAt!+86400000+1000);
  await runMissionSlice({id:m.id,repository:transport});
  expect(transport).toHaveBeenCalledTimes(1);expect((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).status).toBe("PAUSED");
  vi.useRealTimers();
});
test("夏令时换日使用本地日期边界，不能假设每天24小时",()=>{
  for(const [start,end] of [["2026-03-08T05:00:00Z","2026-03-09T04:00:00Z"],["2026-11-01T04:00:00Z","2026-11-02T05:00:00Z"]]){
    expect(Math.abs(+nextBudgetDay("America/New_York",Date.parse(start))-Date.parse(end))).toBeLessThanOrEqual(1000);
  }
});

test("新增工具预算按累计总额复核：遗漏不扩权，UNKNOWN不退还，旧版本及降低被拒绝",async()=>{
 const {u,m}=await fixture();const used={calendarRequests:5,externalWrites:2,unknownCalls:1};
 const paused=await db.agentMission.update({where:{id:m.id},data:{status:"PAUSED",budgetUsedJson:used}});
 const base={models:12,tools:16,activeMs:180000,reservedOutputTokens:12000};
 const first=await reviewMissionBudget(u.id,m.id,{requestId:"omit",expectedVersion:paused.version,totals:base});
 expect(first.budgetJson).toMatchObject({calendarRequests:8,externalWrites:2});
 const body={requestId:"expand",expectedVersion:first.version,totals:{...base,calendarRequests:40,externalWrites:10,browserRequests:80,browserBytes:8000000}};
 const raised=await reviewMissionBudget(u.id,m.id,body);expect(raised.budgetUsedJson).toEqual(used);expect(raised.status).toBe("PAUSED");
 expect((await reviewMissionBudget(u.id,m.id,body)).version).toBe(raised.version);
 await expect(reviewMissionBudget(u.id,m.id,{...body,requestId:"stale"})).rejects.toMatchObject({code:"MISSION_CHANGED"});
 await expect(reviewMissionBudget(u.id,m.id,{...body,requestId:"reduce",expectedVersion:raised.version,totals:{...body.totals,calendarRequests:39}})).rejects.toMatchObject({code:"BUDGET_TOTAL_TOO_SMALL"});
});
