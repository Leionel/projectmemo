import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
const isolated=await vi.hoisted(async()=>{
  const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),Database=(await import("better-sqlite3")).default;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"pm-agent-context-"));process.env.DATABASE_URL=`file:${path.join(directory,"test.db").replaceAll("\\","/")}`;
  process.env.MISSION_ENABLED="true";process.env.MISSION_UI_ENABLED="true";
  const sql=new Database(path.join(directory,"test.db"));for(const folder of fs.readdirSync("prisma/migrations").sort()){const f=path.join("prisma/migrations",folder,"migration.sql");if(fs.existsSync(f))sql.exec(fs.readFileSync(f,"utf8"));}sql.close();return {directory};
});
import fs from "node:fs";
import {db} from "@/lib/db";
import {selectProjectAgentContext,type AgentCandidate} from "@/lib/projectAgentContext";
import {getProjectAgentContext,setProjectAgentFocus} from "@/lib/services/projectAgentContextService";
import {loadGlobalFocus} from "@/lib/server/globalFocus";
import {getProjectReentry} from "@/lib/services/projectReentryService";
import {GET as contextGet,PATCH as contextPatch} from "@/app/api/projects/[id]/agent-context/route";
import {createSession} from "@/lib/auth/session";
let user="",project="",other="",waiting="",running="";
beforeAll(async()=>{
  user=(await db.user.create({data:{username:"context-owner",displayName:"测试",passwordHash:"unused"}})).id;
  other=(await db.user.create({data:{username:"context-other",displayName:"其他用户",passwordHash:"unused"}})).id;
  project=(await db.project.create({data:{title:"同目标测试",goal:"完成课程研究",description:"独立测试",scenario:"RESEARCH",memberships:{create:{userId:user,role:"OWNER"}}}})).id;
  for(const [name,status] of [["waiting","WAITING_INPUT"],["running","RUNNING"],["ready","READY"]]){
    const m=await db.agentMission.create({data:{ownerUserId:user,projectId:project,goal:name,createRequestId:name,createPayloadHash:"hash",constraintsJson:{},successCriteriaJson:[],budgetJson:{},status}});
    if(name==="waiting"){waiting=m.id;await db.agentMissionEvent.create({data:{missionId:m.id,seq:1,type:"QUESTION",payloadJson:{question:"请提供对照组结果"}}});}if(name==="running")running=m.id;
  }
});
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.directory,{recursive:true,force:true});});
const base={projectId:"p",projectTitle:"项目",projectGoal:"项目目标",projectUpdatedAt:"2026-10-23T00:00:00Z"};
function candidate(status:string,id=status):AgentCandidate{return {kind:"MISSION",id,status,title:id,reason:"保留原任务",updatedAt:"2026-10-23T01:00:00Z",version:1,planRevision:2};}
describe("shared next step",()=>{
  it("补料、批准、来源失效先于关注的运行任务和提醒",()=>{
    const all=[candidate("RUNNING"),candidate("PAUSED"),{...candidate("PAUSED","source"),sourceChanged:true},candidate("WAITING_APPROVAL"),candidate("WAITING_INPUT")];
    for(const [status,id] of [["WAITING_INPUT","WAITING_INPUT"],["WAITING_APPROVAL","WAITING_APPROVAL"],["SOURCE_CHANGED","source"],["STOPPED","PAUSED"],["RUNNING","RUNNING"]]){
      const result=selectProjectAgentContext({...base,candidates:all,focusMissionId:"RUNNING"});expect(result.nextStep.attentionKind).toBe(status);expect(result.nextStep.entityRef.id).toBe(id);all.splice(all.findIndex(c=>c.id===id),1);
    }
  });
  it("同类优先关注目标，观察哈希不随读取时间变化",()=>{
    const input={...base,candidates:[candidate("RUNNING","older"),candidate("RUNNING","newer")],focusMissionId:"older"};
    const a=selectProjectAgentContext({...input,generatedAt:"one"}),b=selectProjectAgentContext({...input,generatedAt:"two"});
    expect(a.goalRef).toMatchObject({missionId:"older",planRevision:2});expect(a.observationHash).toBe(b.observationHash);
    expect(a.nextStep.href).toContain("mission=older");
  });
  it("摘要失败不建议创建新任务；真正空项目才提示记录",()=>{
    expect(selectProjectAgentContext({...base,candidates:[],failures:["MISSION_SUMMARY_UNAVAILABLE"]})).toMatchObject({freshness:"UNAVAILABLE",nextStep:{attentionKind:"UNAVAILABLE"}});
    expect(selectProjectAgentContext({...base,candidates:[]})).toMatchObject({freshness:"FRESH",nextStep:{attentionKind:"CAPTURE",actionLabel:"记录第一条资料"}});
    expect(selectProjectAgentContext({...base,candidates:[],hasRecords:true}).nextStep.actionLabel).toBe("记录项目进展");
  });
  it("各入口读取相同目标与原问题，读取无任务或回执写入",async()=>{
    process.env.PROJECT_REENTRY_ENABLED="true";
    const before=await db.agentMissionEvent.count();
    const [context,focus,reentry]=await Promise.all([getProjectAgentContext(user,project),loadGlobalFocus(user),getProjectReentry(project,user)]);
    expect(context?.nextStep).toMatchObject({attentionKind:"WAITING_INPUT",entityRef:{id:waiting}});
    expect(context?.nextStep.entityRef.questionId).toBeTruthy();
    expect(focus.primaryContext?.observationHash).toBe(context?.observationHash);expect(reentry.agentContext?.observationHash).toBe(context?.observationHash);expect(reentry.freshness).toBe("FRESH");
    expect(await db.agentMissionEvent.count()).toBe(before);expect(await db.agentRun.count()).toBe(0);
  });
  it("关注偏好持久化且不能盖过待补料，不改变执行状态",async()=>{
    await setProjectAgentFocus(user,project,running);
    expect((await getProjectAgentContext(user,project))?.focusMissionId).toBe(running);
    expect((await getProjectAgentContext(user,project))?.nextStep.entityRef.id).toBe(waiting);
    expect((await db.agentMission.findUniqueOrThrow({where:{id:running}})).status).toBe("RUNNING");
    await setProjectAgentFocus(user,project,null);
  });
  it("无成员权限不可读；跨项目、跨用户委托不能被设置为关注",async()=>{
    await expect(getProjectAgentContext(other,project)).rejects.toMatchObject({status:404});
    await expect(setProjectAgentFocus(other,project,waiting)).rejects.toMatchObject({status:404});
    const p=await db.project.create({data:{title:"其他项目",goal:"隔离",description:"测试",scenario:"RESEARCH",memberships:{create:{userId:other,role:"OWNER"}}}});
    await expect(setProjectAgentFocus(other,p.id,waiting)).rejects.toMatchObject({status:404});
    await db.projectMembership.create({data:{userId:other,projectId:project,role:"MEMBER"}});
    const member=await getProjectAgentContext(other,project);expect(member?.goalRef.missionId).toBeNull();expect(member?.goal).toBe("完成课程研究");
  });
  it("查询局部失败保留明确降级；不让用户误以为没有委托",async()=>{
    const failure=vi.spyOn(db.agentMission,"findFirst").mockRejectedValue(new Error("internal details"));
    try{const c=await getProjectAgentContext(user,project);expect(c?.freshness).toBe("UNAVAILABLE");expect(c?.fallbackReason).toContain("MISSION_SUMMARY_UNAVAILABLE");expect(JSON.stringify(c)).not.toContain("internal details");}finally{failure.mockRestore();}
  });
  it("真实API校验会话和严格载荷，个人关注接口不变更任务",async()=>{
    const route={params:Promise.resolve({id:project})};
    expect((await contextGet(new Request("http://localhost/context"),route)).status).toBe(401);
    const session=await createSession(user),headers={authorization:`Bearer ${session.token}`,"content-type":"application/json"};
    const read=await contextGet(new Request("http://localhost/context",{headers}),route);
    expect(read.status).toBe(200);expect(read.headers.get("cache-control")).toBe("no-store");
    const invalid=await contextPatch(new Request("http://localhost/context",{method:"PATCH",headers,body:JSON.stringify({missionId:running,approve:true})}),route);expect(invalid.status).toBe(422);
    const result=await contextPatch(new Request("http://localhost/context",{method:"PATCH",headers,body:JSON.stringify({missionId:running})}),route);
    expect(result.status).toBe(200);expect((await result.json()).context.focusMissionId).toBe(running);
    await db.authSession.update({where:{id:session.session.id},data:{revokedAt:new Date()}});
    expect((await contextGet(new Request("http://localhost/context",{headers}),route)).status).toBe(401);
  });
  it("旧逾期提醒与当前未来截止日冲突时，两端拿到核对提示而非过期结论",async()=>{
    const p=await db.project.create({data:{title:"日期核对",goal:"核对材料",description:"合成",scenario:"RESEARCH",deadline:new Date(Date.now()+7*86400000),memberships:{create:{userId:user,role:"OWNER"}}}});
    const reminder=await db.agentIntervention.create({data:{projectId:p.id,triggerType:"DEADLINE_NEAR",dedupeKey:"past",severity:5,title:"截止日期已经过去",content:"项目已经超过截止日期",evidence:{},proposedActions:[]}});
    const c=await getProjectAgentContext(user,p.id);expect(c?.nextStep).toMatchObject({title:"核对提醒与当前截止日",entityRef:{id:reminder.id}});expect(c?.nextStep.reason).toContain("适用阶段");
    expect((await db.agentIntervention.findUniqueOrThrow({where:{id:reminder.id}})).title).toBe("截止日期已经过去");
  });
});
