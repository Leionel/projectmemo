import {vi,beforeAll,afterAll,describe,it,expect} from "vitest";
const isolated=await vi.hoisted(async()=>{
 const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),Database=(await import("better-sqlite3")).default;const dir=fs.mkdtempSync(path.join(os.tmpdir(),"projectmemo-r31-")),file=path.join(dir,"runtime.db");process.env.DATABASE_URL=`file:${file.replaceAll("\\","/")}`;process.env.MISSION_ENABLED="true";process.env.MISSION_WRITES_ENABLED="true";process.env.LLM_MODE="mock";
 const sql=new Database(file);for(const d of fs.readdirSync("prisma/migrations").sort()){const p=path.join("prisma/migrations",d,"migration.sql");if(fs.existsSync(p))sql.exec(fs.readFileSync(p,"utf8"));}sql.close();return{dir,file};
});
import {db} from "@/lib/db";
import {createMission,commandMission,missionDetail,editMission,missionEvents} from "@/lib/mission/missionService";
import { AppError } from "@/lib/api";
import { ModelProtocolError, protocolDiagnostic } from "@/lib/mission/modelProtocol";
import { buildContext } from "@/lib/mission/contextBuilder";
import {runMissionSlice} from "@/lib/mission/runner";
import {claimMission,fenced} from "@/lib/mission/runtimeStore";
import {json,usageOf,type Choice} from "@/lib/mission/contracts";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {createSession} from "@/lib/auth/session";
import {POST as createRoute} from "@/app/api/missions/route";
import fs from "node:fs";
const provider=(choice:Choice)=>async()=>({choice,provider:"TEST_FIXTURE",model:"scripted",protocol:"JSON_CHOICE",usage:{inputTokens:10,outputTokens:5}});
const tool=(name:string,args:unknown):Choice=>({kind:"tool",tool:name,args,summary:"测试"});
let userId:string;
beforeAll(async()=>{const u=await db.user.create({data:{username:`r31-${Date.now()}`,displayName:"独立测试",passwordHash:"unused"}});userId=u.id;});
afterAll(async()=>{await db.$disconnect();for(const name of fs.readdirSync(isolated.dir))fs.unlinkSync(`${isolated.dir}/${name}`);fs.rmdirSync(isolated.dir);});
async function fixture(criteria=["DRAFT_EXISTS"]){const p=await db.project.create({data:{title:"测试项目",description:"隔离数据",goal:"整理进展",scenario:"RESEARCH"}});await db.projectMembership.create({data:{userId,projectId:p.id}});const m=await createMission(userId,{projectId:p.id,requestId:p.id,goal:"整理项目进展",successCriteria:criteria});return{p,m};}
async function slice(id:string,choice:Choice){await runMissionSlice({id,provider:provider(choice)});return missionDetail(userId,id);}
async function propose(id:string){return slice(id,tool("propose_action",{title:"验证分割指标",description:"运行一次本地验证"}));}
async function approve(id:string){const m=await missionDetail(userId,id),a=m.approvals[0];await commandMission(userId,id,"approval",{requestId:"approve",expectedVersion:m.version,decision:"APPROVED",proposalHash:a.proposalHash},a.id);}
const draft=()=>tool("save_mission_output",{blocks:[{blockId:"suggestion",kind:"INFERENCE",text:"建议补充实验指标后再定方案",sourceIds:[]}]});
describe("R3.1 持久执行与原子审批",()=>{
 it("创建幂等，异载荷409；API无会话401，外人404",async()=>{const {p,m}=await fixture();expect((await createMission(userId,{projectId:p.id,requestId:p.id,goal:"整理项目进展"})).id).toBe(m.id);await expect(createMission(userId,{projectId:p.id,requestId:p.id,goal:"其他目标"})).rejects.toMatchObject({status:409});expect((await createRoute(new Request("https://test.invalid/api/missions",{method:"POST",body:"{}"}))).status).toBe(401);await expect(missionDetail("outsider",m.id)).rejects.toMatchObject({status:404});});
 it("真实会话创建快速202，读取不触发执行",async()=>{const {p}=await fixture();const {token}=await createSession(userId);const response=await createRoute(new Request("https://test.invalid/api/missions",{method:"POST",headers:{Authorization:`Bearer ${token}`},body:JSON.stringify({projectId:p.id,requestId:"route",goal:"核对项目材料"})}));expect(response.status).toBe(202);const {mission}=await response.json();expect((await missionDetail(userId,mission.id)).steps).toHaveLength(0);});
 it("观察→草稿→完成，来源版本与步骤保留",async()=>{const {m}=await fixture();let d=await slice(m.id,tool("inspect_project",{}));const source=(d.steps[0].result as {sources:Array<{id:string}>}).sources[0].id;d=await slice(m.id,tool("save_mission_output",{blocks:[{blockId:"p",kind:"PROJECT_OBSERVATION",text:"目标为整理进展",sourceIds:[source]}]}));expect(d.outputs).toHaveLength(1);d=await slice(m.id,{kind:"finish",outputId:d.outputs[0].id});expect(d.status).toBe("SUCCEEDED");expect(d.steps).toHaveLength(2);});
 it("WAITING_INPUT不运行，回答绑定问题且重放幂等",async()=>{const {m}=await fixture();const d=await slice(m.id,{kind:"ask",question:"请补充实验指标",missing:"PRIVATE"});expect(d.status).toBe("WAITING_INPUT");const mocked=vi.fn(provider(draft()));expect(await runMissionSlice({id:m.id,provider:mocked})).toBe(false);expect(mocked).not.toHaveBeenCalled();await expect(commandMission(userId,m.id,"input",{requestId:"bad",expectedVersion:d.version,questionId:"other",answer:"指标0.8"})).rejects.toMatchObject({status:409});const input={requestId:"answer",expectedVersion:d.version,questionId:d.question!.id,answer:"本地指标0.8"};await commandMission(userId,m.id,"input",input);await commandMission(userId,m.id,"input",input);expect((await missionEvents(userId,m.id)).events.filter(e=>e.type==="INPUT")).toHaveLength(1);});
 it("批准前零写入，20次并发重复批准只创建同一行动",async()=>{const {p,m}=await fixture(["ACTION_CREATED"]);const d=await propose(m.id);expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);const a=d.approvals[0];const body={requestId:"concurrent",expectedVersion:d.version,decision:"APPROVED",proposalHash:a.proposalHash};await Promise.all(Array.from({length:20},()=>commandMission(userId,m.id,"approval",body,a.id)));await runMissionSlice({id:m.id,provider:provider(draft())});const actions=await db.actionItem.findMany({where:{projectId:p.id}});expect(actions).toHaveLength(1);expect(actions[0].status).toBe("TODO");expect(await db.agentMissionApproval.count({where:{missionId:m.id,status:"CONSUMED"}})).toBe(1);await commandMission(userId,m.id,"approval",body,a.id);expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(1);});
 it("拒绝和篡改预览都不能写入",async()=>{const {p,m}=await fixture();const d=await propose(m.id),a=d.approvals[0];await expect(commandMission(userId,m.id,"approval",{requestId:"tamper",expectedVersion:d.version,decision:"APPROVED",proposalHash:"changed"},a.id)).rejects.toMatchObject({status:409});await commandMission(userId,m.id,"approval",{requestId:"reject",expectedVersion:d.version,decision:"REJECTED",proposalHash:a.proposalHash},a.id);expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);});
 it("来源改变后旧批准409，未创建行动",async()=>{const {p,m}=await fixture();await slice(m.id,tool("inspect_project",{}));const d=await propose(m.id),a=d.approvals[0];await db.project.update({where:{id:p.id},data:{goal:"新目标"}});await expect(approve(m.id)).rejects.toMatchObject({code:"SOURCE_CHANGED"});expect((await db.agentMissionApproval.findUniqueOrThrow({where:{id:a.id}})).status).toBe("PENDING");expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);});
 it("批准后提交前再查来源，改变或取消都不写",async()=>{const {p,m}=await fixture();await slice(m.id,tool("inspect_project",{}));await propose(m.id);await approve(m.id);await db.project.update({where:{id:p.id},data:{goal:"新目标"}});await runMissionSlice({id:m.id});expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);expect((await missionDetail(userId,m.id)).status).toBe("PAUSED");});
 it("约束可修改/撤销，旧批准失效，模型不能覆盖",async()=>{const {m}=await fixture();const d=await propose(m.id);await editMission(userId,m.id,"constraints",{requestId:"constraint",expectedVersion:d.version,expectedConstraintsVersion:d.constraintsVersion,constraints:{executionBoundary:"READ_ANALYZE",forbiddenApproaches:["云端训练"]}});const updated=await missionDetail(userId,m.id);expect(updated.approvals).toHaveLength(0);const failed=await propose(m.id);expect(failed.status).toBe("PAUSED");expect(failed.error).toMatchObject({code:"CONSTRAINT_BLOCKED"});});
 it("双Worker只有一个租约，过期fence不能提交",async()=>{const {m}=await fixture();const results=await Promise.all([claimMission("one",m.id),claimMission("two",m.id)]);expect(results.filter(Boolean)).toHaveLength(1);const old=results.find(Boolean)!;await db.agentMission.update({where:{id:m.id},data:{leaseUntil:new Date(0)}});const fresh=await claimMission("three",m.id);expect(fresh!.leaseEpoch).toBeGreaterThan(old.leaseEpoch);await expect(db.$transaction(tx=>fenced(tx,{id:m.id,owner:old.leaseOwner!,epoch:old.leaseEpoch,contextVersion:old.contextVersion,planRevision:old.planRevision}))).rejects.toMatchObject({code:"LEASE_LOST"});await db.agentMission.update({where:{id:m.id},data:{status:"CANCELLED",executionSlot:null}});});
 it("预算先预留，耗尽不调用模型；继续不重置",async()=>{const {m}=await fixture();await db.agentMission.update({where:{id:m.id},data:{budgetUsedJson:json({...usageOf({}),models:12})}});const spy=vi.fn(provider(draft()));await runMissionSlice({id:m.id,provider:spy});expect(spy).not.toHaveBeenCalled();const d=await missionDetail(userId,m.id);expect(d.pauseReason).toBe("BUDGET");await commandMission(userId,m.id,"resume",{requestId:"resume",expectedVersion:d.version});await runMissionSlice({id:m.id,provider:spy});expect(spy).not.toHaveBeenCalled();});
 it("未知usage与失败不填零成本",async()=>{const {m}=await fixture();await runMissionSlice({id:m.id,provider:async()=>{throw new Error("timeout");}});const row=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});expect(usageOf(row.budgetUsedJson).unknownCalls).toBe(1);expect(usageOf(row.budgetUsedJson).models).toBe(1);});
 it("输出引用不存在/其他任务来源被拒，不能伪造事实",async()=>{const {m}=await fixture();const d=await slice(m.id,tool("save_mission_output",{blocks:[{blockId:"bad",kind:"PROJECT_OBSERVATION",text:"实验成功",sourceIds:["card:other"]}]}));expect(d.outputs).toHaveLength(0);expect(d.status).toBe("PAUSED");});
 it("停止写开关后保留提案，不消费批准",async()=>{const {p,m}=await fixture();await propose(m.id);await approve(m.id);process.env.MISSION_WRITES_ENABLED="false";try{await runMissionSlice({id:m.id});expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);}finally{process.env.MISSION_WRITES_ENABLED="true";}});
 it("同输入无新观察时停止，终态不能继续",async()=>{const {m}=await fixture();for(let i=0;i<3;i++)await slice(m.id,tool("inspect_action",{actionId:"missing"}));const d=await missionDetail(userId,m.id);expect(d.status).toBe("PAUSED");await commandMission(userId,m.id,"cancel",{requestId:"cancel",expectedVersion:d.version});const c=await missionDetail(userId,m.id);await expect(commandMission(userId,m.id,"resume",{requestId:"terminal",expectedVersion:c.version})).rejects.toMatchObject({status:409});});
 it("重启后不重做成功步骤，事件序号单调",async()=>{const {m}=await fixture();await slice(m.id,tool("inspect_project",{}));await slice(m.id,draft());const d=await missionDetail(userId,m.id);await slice(m.id,{kind:"finish",outputId:d.outputs[0].id});expect((await missionDetail(userId,m.id)).steps.map(s=>s.toolName)).toEqual(["inspect_project","save_mission_output"]);const e=(await missionEvents(userId,m.id)).events;expect(new Set(e.map(e=>e.seq)).size).toBe(e.length);});
 it("子进程提交后未回包即退出，恢复后只保留一个Action",async()=>{const {p,m}=await fixture();await propose(m.id);await approve(m.id);const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:m.id,status:"READY"}});const code=`(async()=>{const {claimMission}=await import('./lib/mission/runtimeStore.ts');const {commitApprovedAction}=await import('./lib/mission/approvalService.ts');const m=await claimMission('crash-child',${JSON.stringify(m.id)});await commitApprovedAction({id:m.id,owner:m.leaseOwner,epoch:m.leaseEpoch,contextVersion:m.contextVersion,planRevision:m.planRevision},${JSON.stringify(step.id)});process.exit(17);})();`;const result=spawnSync(process.execPath,[path.resolve('node_modules/tsx/dist/cli.mjs'),'--eval',code],{env:{...process.env,DATABASE_URL:`file:${isolated.file.replaceAll('\\','/')}`},encoding:'utf8',timeout:20000});expect(result.status,result.stderr).toBe(17);expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(1);await slice(m.id,draft());expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(1);expect((await db.agentMissionStep.findUniqueOrThrow({where:{id:step.id}})).status).toBe('SUCCEEDED');});

 it("事务中断10次均不遗留Action或消费回执，修复后仅提交一次",async()=>{const {p,m}=await fixture();await propose(m.id);await approve(m.id);await db.$executeRawUnsafe(`CREATE TRIGGER r31_abort BEFORE INSERT ON ActionItem WHEN NEW.projectId='${p.id}' BEGIN SELECT RAISE(ABORT,'injected'); END`);try{for(let i=0;i<10;i++){await runMissionSlice({id:m.id});expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(0);expect(await db.agentMissionApproval.count({where:{missionId:m.id,status:'CONSUMED'}})).toBe(0);const d=await missionDetail(userId,m.id);await commandMission(userId,m.id,'resume',{requestId:'rollback-'+i,expectedVersion:d.version});}}finally{await db.$executeRawUnsafe('DROP TRIGGER r31_abort');}await runMissionSlice({id:m.id});expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(1);});
 it("连续无进展调用达到上限后停止",async()=>{const {m}=await fixture();for(let i=0;i<4;i++)await slice(m.id,tool('inspect_project',{}));const d=await missionDetail(userId,m.id);expect(d.status).toBe('PAUSED');expect(d.error).toMatchObject({code:'NO_PROGRESS'});});

 it("等待批准暂停恢复保留等待状态，随后故障恢复不会跳回旧等待",async()=>{const {m}=await fixture();let d=await propose(m.id);await commandMission(userId,m.id,'pause',{requestId:'pause-wait',expectedVersion:d.version});d=await missionDetail(userId,m.id);await commandMission(userId,m.id,'resume',{requestId:'resume-wait',expectedVersion:d.version});expect((await missionDetail(userId,m.id)).status).toBe('WAITING_APPROVAL');await approve(m.id);await runMissionSlice({id:m.id});await slice(m.id,tool('inspect_action',{actionId:'missing'}));d=await missionDetail(userId,m.id);expect(d.status).toBe('PAUSED');await commandMission(userId,m.id,'resume',{requestId:'resume-error',expectedVersion:d.version});expect((await missionDetail(userId,m.id)).status).toBe('READY');});
 it("等待输入暂停恢复不丢失原问题",async()=>{const {m}=await fixture();let d=await slice(m.id,{kind:'ask',question:'缺实验指标',missing:'PRIVATE'});const q=d.question!.id;await commandMission(userId,m.id,'pause',{requestId:'pause-input',expectedVersion:d.version});d=await missionDetail(userId,m.id);await commandMission(userId,m.id,'resume',{requestId:'resume-input',expectedVersion:d.version});d=await missionDetail(userId,m.id);expect(d.status).toBe('WAITING_INPUT');expect(d.question!.id).toBe(q);});
 it("过期批准可显式重规划并得到新预览",async()=>{const {m}=await fixture();let d=await propose(m.id);const old=d.approvals[0].id;await db.agentMissionApproval.update({where:{id:old},data:{expiresAt:new Date(0)}});await expect(approve(m.id)).rejects.toMatchObject({code:'APPROVAL_CHANGED'});await commandMission(userId,m.id,'replan',{requestId:'replan',expectedVersion:d.version});d=await propose(m.id);expect(d.status).toBe('WAITING_APPROVAL');expect(d.approvals[0].id).not.toBe(old);});
 it("撤权的最早任务暂停，后续合法任务仍可领取",async()=>{await db.agentMission.updateMany({where:{status:'READY'},data:{status:'PAUSED'}});const a=await fixture(),b=await fixture();await db.projectMembership.delete({where:{userId_projectId:{userId,projectId:a.p.id}}});const next=await claimMission('queue-recovery');expect(next!.id).toBe(b.m.id);expect((await db.agentMission.findUniqueOrThrow({where:{id:a.m.id}})).status).toBe('PAUSED');await db.agentMission.update({where:{id:b.m.id},data:{status:'CANCELLED',executionSlot:null}});});

 it("原生协议错误只修复一次，仍失败则暂停且预算累计",async()=>{const {m}=await fixture();const bad=vi.fn(async()=>{throw new AppError('MODEL_PROTOCOL_ERROR','并行调用需修复',409);});await runMissionSlice({id:m.id,provider:bad});expect((await missionDetail(userId,m.id)).status).toBe('READY');await runMissionSlice({id:m.id,provider:bad});expect((await missionDetail(userId,m.id)).status).toBe('PAUSED');expect(bad).toHaveBeenCalledTimes(2);expect(usageOf((await db.agentMission.findUniqueOrThrow({where:{id:m.id}})).budgetUsedJson).models).toBe(2);});

 it("失败响应结算用量并给出纠错；截断加长仍受总预算约束",async()=>{
  const {m}=await fixture();
  const bad=async()=>{throw new ModelProtocolError(protocolDiagnostic("TRUNCATED","length",25),{provider:"deepseek",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:123,outputTokens:1000}});};
  await runMissionSlice({id:m.id,provider:bad});
  let row=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});
  expect(usageOf(row.budgetUsedJson)).toMatchObject({models:1,inputTokens:123,outputTokens:1000,unknownCalls:0,reservedOutputTokens:1000});
  const context=JSON.parse(await buildContext(row));
  expect(context.outputTokenLimit).toBe(2000);
  expect(context.recentInputs.at(-1).payload).toMatchObject({reason:"TRUNCATED",repairHint:expect.stringContaining("压缩草稿")});
  await db.agentMission.update({where:{id:m.id},data:{budgetJson:json({...row.budgetJson as object,reservedOutputTokens:2500})}});
  const spy=vi.fn(bad);await runMissionSlice({id:m.id,provider:spy});expect(spy).not.toHaveBeenCalled();
  row=await db.agentMission.findUniqueOrThrow({where:{id:m.id}});expect(row.pauseReason).toBe("BUDGET");
  expect(usageOf(row.budgetUsedJson).models).toBe(1);
 });
 it("成功进展和人工继续后各允许一次纠错，不重做已有步骤",async()=>{
  const {m}=await fixture();const bad=async()=>{throw new ModelProtocolError(protocolDiagnostic("INVALID_JSON","stop",10),{provider:"fixture",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:11,outputTokens:4}});};
  await runMissionSlice({id:m.id,provider:bad});await slice(m.id,tool("inspect_project",{}));
  expect((await missionDetail(userId,m.id)).error).toBeNull();
  await runMissionSlice({id:m.id,provider:bad});expect((await missionDetail(userId,m.id)).status).toBe("READY");
  await runMissionSlice({id:m.id,provider:bad});let d=await missionDetail(userId,m.id);expect(d.status).toBe("PAUSED");
  await commandMission(userId,m.id,"resume",{requestId:"resume-fixed-protocol",expectedVersion:d.version});
  await runMissionSlice({id:m.id,provider:bad});d=await missionDetail(userId,m.id);expect(d.status).toBe("READY");
  await slice(m.id,draft());d=await missionDetail(userId,m.id);expect(d.outputs).toHaveLength(1);
  expect(d.steps.map(s=>s.toolName)).toEqual(["inspect_project","save_mission_output"]);
  expect((await missionEvents(userId,m.id)).events.filter(e=>e.type==="MODEL_PROTOCOL_ERROR")).toHaveLength(4);
 });
 it("模拟 HTTP 的截断→纠错→保存→完成，记录来源模型与失败用量，不落原始回复",async()=>{
  const {m}=await fixture();await db.agentMission.update({where:{id:m.id},data:{constraintsJson:json({...m.constraintsJson as object,llmContextApproved:true})}});
  vi.stubEnv("LLM_MODE","openai-compatible");vi.stubEnv("LLM_PROVIDER","deepseek");vi.stubEnv("LLM_API_KEY","test-key");vi.stubEnv("MISSION_MODEL_PROTOCOL","json");
  let ordinal=0;const calls:Array<Record<string,unknown>>=[];
  vi.stubGlobal("fetch",vi.fn(async(_url,init)=>{
   const body=JSON.parse(init.body);calls.push(body);ordinal++;
   const value=ordinal===1?'private-raw-response-secret':ordinal===2?JSON.stringify(draft()):JSON.stringify({kind:"finish",outputId:(await missionDetail(userId,m.id)).outputs[0].id});
   return new Response(JSON.stringify({choices:[{finish_reason:ordinal===1?"length":"stop",message:{content:value}}],usage:{prompt_tokens:100,completion_tokens:ordinal===1?1000:50}}));
  }));
  try{
   await runMissionSlice({id:m.id});await runMissionSlice({id:m.id});await runMissionSlice({id:m.id});
   const d=await missionDetail(userId,m.id);expect(d.status).toBe("SUCCEEDED");expect(d.outputs).toHaveLength(1);expect(d.steps).toHaveLength(1);
   expect(d.used).toMatchObject({models:3,inputTokens:300,outputTokens:1100,unknownCalls:0,reservedOutputTokens:4000});
   expect(calls.map(c=>c.max_tokens)).toEqual([1000,2000,1000]);
   const runs=await db.agentRun.findMany({where:{projectId:m.projectId}});expect(runs.find(r=>r.status==="FAILED")?.provider).toBe("deepseek");
   expect(JSON.stringify(runs)).not.toContain("private-raw-response-secret");
   expect(JSON.stringify((await missionEvents(userId,m.id)).events)).not.toContain("private-raw-response-secret");
  }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });

 it.each(["批准前", "提交前"])("行动读回后来源在%s取消，不得按旧依据创建后续行动",async(changeAt)=>{
  const {p,m}=await fixture();
  const action=await db.actionItem.create({data:{projectId:p.id,title:"尚未完成实验",description:"原实验安排",priority:1}});
  const observed=await slice(m.id,tool("inspect_action",{actionId:action.id}));
  expect(observed.steps[0].result).toMatchObject({sources:[{id:`action:${action.id}`,kind:"PROJECT",entityType:"ACTION"}]});
  const proposal=await slice(m.id,tool("propose_action",{title:"按原实验安排开展后续验证"}));
  const approval=proposal.approvals[0];
  const frozen=await db.agentMissionApproval.findUniqueOrThrow({where:{id:approval.id}});
  expect(frozen.readSetJson).toEqual(expect.arrayContaining([expect.objectContaining({id:`action:${action.id}`})]));
  if(changeAt==="提交前")await approve(m.id);
  await db.actionItem.update({where:{id:action.id},data:{status:"CANCELLED",description:"实验已取消，不应继续后续验证"}});
  if(changeAt==="批准前"){
   await expect(approve(m.id)).rejects.toMatchObject({code:"SOURCE_CHANGED"});
   expect((await db.agentMissionApproval.findUniqueOrThrow({where:{id:approval.id}})).status).toBe("PENDING");
  }else{
   await runMissionSlice({id:m.id,provider:provider(draft())});
   expect((await missionDetail(userId,m.id)).status).toBe("PAUSED");
  }
  expect(await db.actionItem.count({where:{projectId:p.id}})).toBe(1);
  expect(await db.agentMissionApproval.count({where:{missionId:m.id,status:"CONSUMED"}})).toBe(0);
 });

 it.each(["constraints", "research-scope"] as const)("等待输入暂停后编辑%s，恢复仍须回答原问题才可执行",async(kind)=>{
  const {m}=await fixture();
  let d=await slice(m.id,{kind:"ask",question:"请补充必须由本人提供的实验指标",missing:"PRIVATE"});
  const questionId=d.question!.id;
  await commandMission(userId,m.id,"pause",{requestId:"pause-before-edit",expectedVersion:d.version});
  d=await missionDetail(userId,m.id);
  await editMission(userId,m.id,kind,{requestId:"edit-while-waiting",expectedVersion:d.version,...(kind==="constraints"?{expectedConstraintsVersion:d.constraintsVersion,constraints:{availableMinutes:30}}:{expectedScopeVersion:d.researchScopeVersion,scope:{enabled:false}})});
  d=await missionDetail(userId,m.id);
  await commandMission(userId,m.id,"resume",{requestId:"resume-after-edit",expectedVersion:d.version});
  d=await missionDetail(userId,m.id);
  expect(d.status).toBe("WAITING_INPUT");
  expect(d.question!.id).toBe(questionId);
  const mocked=vi.fn(provider(draft()));
  expect(await runMissionSlice({id:m.id,provider:mocked})).toBe(false);
  expect(mocked).not.toHaveBeenCalled();
  expect(await db.agentMissionEvent.count({where:{missionId:m.id,type:"INPUT"}})).toBe(0);
  await commandMission(userId,m.id,"input",{requestId:"answer-after-edit",expectedVersion:d.version,questionId,answer:"本地实验指标为0.71"});
  await runMissionSlice({id:m.id,provider:mocked});
  expect(mocked).toHaveBeenCalledOnce();
  expect((await missionDetail(userId,m.id)).outputs).toHaveLength(1);
 });

});
