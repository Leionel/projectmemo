import {afterAll,expect,test,vi} from "vitest";
const isolated=await vi.hoisted(async()=>{process.env.DEPLOYMENT_OBSERVER_ENABLED="true";return(await import("./helpers/continuityDatabase")).continuityDatabase("ct7-runtime");});
import fs from "node:fs";
import {db} from "@/lib/db";
import {createDeploymentConnection,controlDeploymentConnection,listDeploymentConnections} from "@/lib/sensing/deploymentConnections";
import {createMission,editContinuationPolicy} from "@/lib/mission/missionService";
import {runMissionSlice} from "@/lib/mission/runner";
import {processInvestigationDelegations} from "@/lib/mission/investigationDelegation";
import {record} from "@/lib/conversation/repository";
import {sourceUse} from "@/lib/continuity/sourcePolicy";
import type {DeploymentTransport} from "@/lib/sensing/deploymentTransport";
afterAll(async()=>{vi.useRealTimers();await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
async function fixture(){
  const u=await db.user.create({data:{username:crypto.randomUUID(),displayName:"工程验收",passwordHash:"unused"}}),p=await db.project.create({data:{title:"固定环境验收",description:"隔离测试",goal:"核对期望release是否可供用户使用",scenario:"RESEARCH",memberships:{create:{userId:u.id}}}});
  const config={schemaVersion:1,environment:"预发布",origin:"https://service.example.org",healthPath:"/health",userPath:"/public/check",expectedRelease:"abcdef012345",expiresAt:new Date(Date.now()+86400000).toISOString()};
  await createDeploymentConnection(u.id,p.id,{requestId:"grant",confirmedReadOnly:true,config});
  const c=(await listDeploymentConnections(u.id,p.id)).connections[0],m=await createMission(u.id,{projectId:p.id,requestId:"mission",goal:p.goal,llmContextApproved:true});
  return{u,p,c,m,config};
}
const response=()=>({status:200,contentType:"application/json",body:{status:"ok",release:"abcdef012345",checked_at:new Date().toISOString(),secret:"SHOULD_NOT_PERSIST"},observedAt:new Date().toISOString()});
const choice=(id:string)=>async()=>({choice:{kind:"tool" as const,tool:"inspect_deployment",args:{connectionId:id},summary:"检查原环境"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}});
test("原Mission动态选工具、累计HTTP与分层来源：旧release/登录HTML不产生现实完成",async()=>{
  const {u,p,c,m}=await fixture();
  const transport:DeploymentTransport=vi.fn(async url=>url.endsWith("/health")?{...response(),body:{...response().body,release:"oldrelease"}}:{...response(),contentType:"text/html",body:"login"});
  await runMissionSlice({id:m.id,provider:choice(c.id),deployment:transport});
  const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:m.id}}),obs=record(record(step.resultJson).data).observation;
  expect(step.status).toBe("SUCCEEDED");expect(record(obs).layers).toMatchObject([{state:"UNKNOWN"},{state:"FAILED"},{state:"OBSERVED"},{state:"UNKNOWN"}]);
  expect((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).budgetUsedJson).toMatchObject({models:1,tools:1,metadataRequests:2});
  expect(JSON.stringify(step.protocolJson)).not.toContain("SHOULD_NOT_PERSIST");expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);
  const stored=await db.sourceConnection.findUniqueOrThrow({where:{id:c.id}});expect(stored).toMatchObject({repo:null,ref:null,provider:"DEPLOYMENT"});
  const source=record((record(step.resultJson).sources as unknown[])[0]);
  const artifact=await db.generatedArtifact.create({data:{projectId:p.id,artifactType:"weekly_report",content:"派生的环境摘要",sourceRefs:{sources:[{sourceId:String(source.id),projectId:p.id}]}}});
  expect((await sourceUse(u.id,p.id,"artifact:"+artifact.id)).state).toBe("ALLOWED");
  vi.setSystemTime(Date.now()+700000);
  expect(await sourceUse(u.id,p.id,"artifact:"+artifact.id)).toMatchObject({state:"SUPPRESSED",reason:"DEPLOYMENT_OBSERVATION_STALE"});
  vi.useRealTimers();
});
test("HTTP在途撤权不会发布迟到来源，保留原预占和授权回执",async()=>{
  const {u,p,c,m}=await fixture();let begin!:()=>void,finish!:()=>void;
  const started=new Promise<void>(r=>{begin=r;}),barrier=new Promise<void>(r=>{finish=r;});
  const transport=vi.fn(async()=>{begin();await barrier;return response();});
  const running=runMissionSlice({id:m.id,provider:choice(c.id),deployment:transport});await started;
  await controlDeploymentConnection(u.id,p.id,c.id,{requestId:"revoke",expectedVersion:c.revision,action:"REVOKE"});finish();await running;
  const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:m.id}});
  expect(step.status).not.toBe("SUCCEEDED");expect(record(step.resultJson).sources).toBeUndefined();expect(transport).toHaveBeenCalledTimes(1);
  expect((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).budgetUsedJson).toMatchObject({metadataRequests:1});
});
test("部署持续观察不依赖CI；同一状态与时间刷新零新增模型，原Worker原账本接续",async()=>{
  process.env.MISSION_INVESTIGATION_DELEGATION_ENABLED="true";
  const {u,c,m}=await fixture();
  await editContinuationPolicy(u.id,m.id,{requestId:"continue",expectedVersion:m.version,policy:{mode:"BOUNDED_INVESTIGATION",schemaVersion:1,expiresAt:new Date(Date.now()+3600000).toISOString(),checkEveryMinutes:1,maxModels:4,maxTools:12,maxMetadataRequests:12,allowedTools:["inspect_deployment"],connectionIds:[c.id]}});
  await db.agentMission.update({where:{id:m.id},data:{status:"WAITING_INPUT",nextAttemptAt:null}});
  const transport=vi.fn(async()=>response()),provider=vi.fn(async()=>{throw new Error("无变化不得调用模型");});
  await processInvestigationDelegations();await runMissionSlice({id:m.id,deployment:transport,provider});await runMissionSlice({id:m.id,deployment:transport,provider});
  // First actual observation creates a baseline; isolate a second declared cycle.
  await db.agentMission.update({where:{id:m.id},data:{status:"WAITING_INPUT",nextAttemptAt:null}});
  await processInvestigationDelegations();await runMissionSlice({id:m.id,deployment:transport,provider});await runMissionSlice({id:m.id,deployment:transport,provider});
  expect(provider).not.toHaveBeenCalled();expect(transport).toHaveBeenCalledTimes(4);
  const current=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});expect(current.status).toBe("WAITING_INPUT");expect(current.budgetUsedJson).toMatchObject({models:0,tools:2,metadataRequests:4});
});

test("HTTP扩额只复用原显式预算复核，保留UNKNOWN且仍暂停",async()=>{
 const {u,m}=await fixture();const paused=await db.agentMission.update({where:{id:m.id},data:{status:"PAUSED",budgetUsedJson:{metadataRequests:24,unknownCalls:1}}});
 const {reviewMissionBudget}=await import("@/lib/mission/budgetReview");
 await expect(reviewMissionBudget(u.id,m.id,{requestId:"too-low",expectedVersion:paused.version,totals:{models:12,tools:16,activeMs:180000,reservedOutputTokens:12000,metadataRequests:23}})).rejects.toMatchObject({code:"BUDGET_TOTAL_TOO_SMALL"});
 const reviewed=await reviewMissionBudget(u.id,m.id,{requestId:"http-review",expectedVersion:paused.version,totals:{models:12,tools:16,activeMs:180000,reservedOutputTokens:12000,metadataRequests:48}});
 expect(reviewed.status).toBe("PAUSED");expect(reviewed.budgetUsedJson).toMatchObject({metadataRequests:24,unknownCalls:1});expect(reviewed.budgetJson).toMatchObject({metadataRequests:48});
});

test("环境证据关联原提案；用户批准创建行动并回读完成回执，服务自检不自动完成行动",async()=>{
 const {u,p,c,m}=await fixture();
 await runMissionSlice({id:m.id,provider:choice(c.id),deployment:async()=>response()});
 await runMissionSlice({id:m.id,provider:async()=>({choice:{kind:"tool",tool:"propose_action",args:{title:"人工核对登录后用户路径"},summary:"请求协作"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 const pending=await db.agentMission.findUniqueOrThrow({where:{id:m.id}}),approval=await db.agentMissionApproval.findFirstOrThrow({where:{missionId:m.id,status:"PENDING"}});
 expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);
 const {commandMission}=await import("@/lib/mission/missionService");
 await commandMission(u.id,m.id,"approval",{requestId:"approve-original",expectedVersion:pending.version,decision:"APPROVED",proposalHash:approval.proposalHash},approval.id);
 await runMissionSlice({id:m.id});
 const action=await db.actionItem.findFirstOrThrow({where:{projectId:p.id}});expect(action.status).toBe("TODO");expect(action.resultCardId).toBeNull();
 const {completeProjectAction}=await import("@/lib/services/actionService");const result=await completeProjectAction(p.id,action.id,"用户在隔离测试中报告已核对登录路径；不是部署平台回执");
 expect(result.resultCardId).toBeTruthy();expect((await completeProjectAction(p.id,action.id,"同一结果回执重放" )).resultCardId).toBe(result.resultCardId);
});

test("停止使用连接根会关闭部署来源和派生摘要的消费",async()=>{
 const {u,p,c,m}=await fixture();await runMissionSlice({id:m.id,provider:choice(c.id),deployment:async()=>response()});
 const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:m.id}}),source=record((record(step.resultJson).sources as unknown[])[0]);
 const {createSession}=await import("@/lib/auth/session"),actor={userId:u.id,sessionId:(await createSession(u.id)).session.id};
 const {createConversation}=await import("@/lib/conversation/service"),conversation=await createConversation(actor,{requestId:"source-discussion",scope:"PROJECT",projectId:p.id});
 const {submitDirective}=await import("@/lib/continuity/directiveService");await submitDirective(actor,conversation.id,{commandId:"suppress-connection",expectedSeq:0,scope:{projectId:p.id},operation:"SUPPRESS_USE",sourceIds:["connection:"+c.id]});
 expect((await sourceUse(u.id,p.id,String(source.id))).state).toBe("SUPPRESSED");
});
