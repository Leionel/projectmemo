import {beforeAll,afterAll,describe,it,expect,vi} from "vitest";
const isolated=await vi.hoisted(async()=>{
  const fs=await import("node:fs"),os=await import("node:os"),path=await import("node:path"),Database=(await import("better-sqlite3")).default;
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"projectmemo-ux-summary-"));
  process.env.DATABASE_URL=`file:${path.join(directory,"summary.db").replaceAll("\\","/")}`;
  process.env.MISSION_ENABLED="true";process.env.MISSION_UI_ENABLED="true";
  const sql=new Database(path.join(directory,"summary.db"));
  for(const folder of fs.readdirSync("prisma/migrations").sort()){const file=path.join("prisma/migrations",folder,"migration.sql");if(fs.existsSync(file))sql.exec(fs.readFileSync(file,"utf8"));}
  sql.close();return{directory};
});
import fs from "node:fs";
import {missionDetail,commandMission} from "@/lib/mission/missionService";
import {db} from "@/lib/db";
import {missionWorkspaceSummary} from "@/lib/mission/workspaceSummary";
let user="",project="",waiting="";
beforeAll(async()=>{
  const owner=await db.user.create({data:{username:"ux-summary-owner",displayName:"UX测试",passwordHash:"unused"}});user=owner.id;
  const p=await db.project.create({data:{title:"独立UX测试",description:"测试",goal:"准备汇报",scenario:"RESEARCH",memberships:{create:{userId:user,role:"OWNER"}}}});project=p.id;
  const m=await db.agentMission.create({data:{ownerUserId:user,projectId:project,goal:"需补充对照组的汇报",createRequestId:"waiting",createPayloadHash:"test",successCriteriaJson:["DRAFT_EXISTS"],constraintsJson:{},budgetJson:{},status:"WAITING_INPUT",updatedAt:new Date("2026-01-01")}});waiting=m.id;
  await db.agentMissionEvent.create({data:{missionId:waiting,seq:1,type:"QUESTION",payloadJson:{question:"请补充同条件下的对照组指标"}}});
  await db.agentMissionOutput.create({data:{missionId:waiting,revision:2,kind:"RESEARCH",contentJson:{blocks:[]},sourceRefsJson:[],claimChecksJson:[]}});
  for(let i=0;i<5;i++)await db.agentMission.create({data:{ownerUserId:user,projectId:project,goal:`后台任务${i}`,createRequestId:`run-${i}`,createPayloadHash:"test",successCriteriaJson:[],constraintsJson:{},budgetJson:{},status:"RUNNING"}});
});
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.directory,{recursive:true,force:true});});
describe("双端委托只读摘要",()=>{
  it("旧等待任务优先于新运行任务，响应有界且活动来自持久输出",async()=>{
    const before=await db.agentMissionEvent.count();const result=await missionWorkspaceSummary(user,project);
    expect(result.totalActive).toBe(6);expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({id:waiting,status:"WAITING_INPUT",attention:"请补充同条件下的对照组指标",activity:"草稿修订 2 已保存",outputRevision:2});
    expect(result.items[0].activityAt).toBeTruthy();expect(await db.agentMissionEvent.count()).toBe(before);
    expect((await db.agentMission.findUniqueOrThrow({where:{id:waiting}})).status).toBe("WAITING_INPUT");
  });
  it("非Owner不能读取标题、问题或数量",async()=>{
    const member=await db.user.create({data:{username:"ux-summary-member",displayName:"成员",passwordHash:"unused"}});
    await db.projectMembership.create({data:{projectId:project,userId:member.id,role:"MEMBER"}});
    await expect(missionWorkspaceSummary(member.id,project)).rejects.toMatchObject({status:404});
  });
  it("运行中的暂停只是请求，详情保留RUNNING并暴露持久请求时间",async()=>{
    const running=await db.agentMission.findFirstOrThrow({where:{projectId:project,status:"RUNNING"}});
    await commandMission(user,running.id,"pause",{requestId:"pause-request",expectedVersion:running.version});
    const detail=await missionDetail(user,running.id);expect(detail.status).toBe("RUNNING");expect(detail.pauseRequestedAt).toBeTruthy();expect(detail.cancelRequestedAt).toBeNull();
  });
  it("关闭UI与网络失败不同：关闭返回明确enabled=false，历史不删除",async()=>{
    process.env.MISSION_UI_ENABLED="false";
    try{expect(await missionWorkspaceSummary(user,project)).toEqual({enabled:false,totalActive:0,items:[]});expect(await db.agentMission.count({where:{projectId:project}})).toBe(6);}
    finally{process.env.MISSION_UI_ENABLED="true";}
  });
});
