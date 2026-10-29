import { E2E_DATABASE_URL, E2E_ENV } from "./e2e-env";
if(process.env.DATABASE_URL!==E2E_DATABASE_URL)throw new Error("Stages23 fixture requires isolated E2E database");
Object.assign(process.env,E2E_ENV);
const [operation,value]=process.argv.slice(2),{db}=await import("../lib/db");
try{
 if(operation==="create"){
  const project=await db.project.create({data:{title:"持续调查授权验收",description:"STAGES23_BROWSER_SYNTHETIC",goal:"调查当前失败条件",scenario:"COMPETITION",memberships:{create:{userId:value}}}});
  const c=await db.sourceConnection.create({data:{projectId:project.id,ownerUserId:value,repo:"octokit/rest.js",ref:"main"}});
  const {createMission}=await import("../lib/mission/missionService");
  const m=await createMission(value,{projectId:project.id,requestId:"m",goal:"持续核对新到资料",llmContextApproved:true});
  console.log(JSON.stringify({projectId:project.id,connectionId:c.id,missionId:m.id}));
 }else if(operation==="remove"){
  const p=await db.project.findFirstOrThrow({where:{id:value,description:"STAGES23_BROWSER_SYNTHETIC"}});await db.project.delete({where:{id:p.id}});
 }else throw new Error("Expected create/remove");
}finally{await db.$disconnect();}
