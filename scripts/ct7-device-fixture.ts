import fs from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {isolatedContinuityEvaluation} from "./continuity-evaluation/environment";
import {E2E_ENV} from "./e2e-env";

if(process.argv.includes("--serve")){
  const receipt=JSON.parse(fs.readFileSync("evidence/r4-deployment/20261031-acceptance/device-fixture.json","utf8"));
  if(!/^file:.*pm-ct7-device-.*evaluation\.db$/.test(receipt.databaseUrl))throw new Error("仅允许隔离设备验收库");
  const result=spawnSync(process.execPath,[path.resolve("node_modules/next/dist/bin/next"),"dev","--hostname","127.0.0.1","--port","4401"],{stdio:"inherit",env:{...process.env,...E2E_ENV,DATABASE_URL:receipt.databaseUrl,NEXT_DIST_DIR:".next-device-ct7"}});
  process.exit(result.status??1);
}

// Creates a fresh, disposable database. No development/production credentials or database are read.
if(fs.existsSync("evidence/r4-deployment/20261031-acceptance/device-fixture.json"))throw new Error("本轮验收夹具已存在；请保留原证据，在新目录建立下一轮验收。现有后端可使用 --serve 接续。");
const env=isolatedContinuityEvaluation("ct7-device");
process.env.DEPLOYMENT_OBSERVER_ENABLED="true";
const {db}=await import("../lib/db");
const {hashPassword}=await import("../lib/auth/password");
const {createDeploymentConnection,listDeploymentConnections}=await import("../lib/sensing/deploymentConnections");
const {createMission}=await import("../lib/mission/missionService");
const {runMissionSlice}=await import("../lib/mission/runner");
try{
  const user=await db.user.create({data:{username:"ct7-acceptance",displayName:"CT7 隔离验收",passwordHash:await hashPassword("ct7-acceptance-pass")}});
  const project=await db.project.create({data:{title:"课程项目上线核对",description:"模拟器隔离验收；HTTP与模型为合成fixture",goal:"核对发布版本，并保留未确认项",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}});
  await createDeploymentConnection(user.id,project.id,{requestId:"device-fixture-grant",confirmedReadOnly:true,config:{schemaVersion:1,environment:"预发布环境",origin:"https://service.example.org",expectedRelease:"abcdef012345",expiresAt:new Date(Date.now()+86400000).toISOString()}});
  const connection=(await listDeploymentConnections(user.id,project.id)).connections[0];
  const mission=await createMission(user.id,{requestId:"device-fixture-mission",projectId:project.id,goal:project.goal,llmContextApproved:true});
  await runMissionSlice({id:mission.id,provider:async()=>({choice:{kind:"tool",tool:"inspect_deployment",args:{connectionId:connection.id},summary:"读取已授权的环境"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}}),deployment:async()=>({status:200,contentType:"application/json",body:{status:"ok",release:"oldrelease",checked_at:new Date().toISOString()},observedAt:new Date().toISOString()})});
  const receipt={databaseUrl:process.env.DATABASE_URL,projectId:project.id,missionId:mission.id,connectionId:connection.id,fixture:"SYNTHETIC_MODEL_AND_HTTP",productionWrites:false};
  const output=path.resolve("evidence/r4-deployment/20261031-acceptance/device-fixture.json");
  fs.writeFileSync(output,JSON.stringify(receipt,null,2)+"\n");
  console.log(JSON.stringify({directory:env.directory,projectId:project.id,output}));
}finally{await db.$disconnect();}
