import fs from "node:fs";
import path from "node:path";
import { isolatedContinuityEvaluation } from "./continuity-evaluation/environment";
const output=path.resolve(process.argv[2]??"output/r4-experiments/real-sandbox-20261029.json");
if(!output.startsWith(path.resolve("output")+path.sep)||fs.existsSync(output))throw new Error("FRESH_OUTPUT_PATH_REQUIRED");
fs.mkdirSync(path.dirname(output),{recursive:true});const environment=isolatedContinuityEvaluation("ct5-sandbox");
Object.assign(process.env,{EXPERIMENT_OBSERVER_ENABLED:"true",SANDBOX_VERIFICATION_ENABLED:"true",MISSION_WRITES_ENABLED:"true"});
const {db}=await import("../lib/db"),{createMission,missionDetail,commandMission}=await import("../lib/mission/missionService"),{runMissionSlice}=await import("../lib/mission/runner"),{sourceHash}=await import("../lib/mission/repository");
const report={kind:"REAL_DOCKER_ORIGINAL_MISSION_SYNTHETIC_INPUT_SCRIPTED_MODEL",database:environment.file,status:"STARTED",view:null as unknown};
fs.writeFileSync(output,JSON.stringify(report,null,2),{flag:"wx"});
try{
 const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"合成核算验收",passwordHash:"unused"}}),project=await db.project.create({data:{title:"固定核算隔离探针",description:"SYNTHETIC_NOT_A_REAL_EXPERIMENT",goal:"核对指标下降，决定下一步复核",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}});
 const row={runId:"a",method:"A",metric:"accuracy",value:0.8,unit:"ratio",period:"2026-10-29",direction:"HIGHER_BETTER",dataset:"D@1",split:"test@1",seed:"42",evaluationCode:"eval@1",environment:"CPU@1",phase:"inference",batchSize:"1"};
 const capture=await db.capture.create({data:{projectId:project.id,rawText:JSON.stringify([row,{...row,runId:"b",method:"B",value:0.7}]),sourceType:"EXPERIMENT_METRICS"}}),sourceId="capture:"+capture.id,revision=(await sourceHash(project.id,sourceId))!;
 const mission=await createMission(user.id,{projectId:project.id,requestId:"probe",goal:project.goal,llmContextApproved:true});
 await runMissionSlice({id:mission.id,provider:async()=>({choice:{kind:"tool",tool:"propose_metric_verification",args:{sourceId,revision,format:"JSON",leftRun:"a",rightRun:"b",metric:"accuracy"},summary:"先提交固定核算预览"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 const preview=await missionDetail(user.id,mission.id);if(preview.status!=="WAITING_APPROVAL")throw new Error("PROPOSAL_FAILED:"+JSON.stringify(preview.error));const approval=preview.approvals[0];
 await commandMission(user.id,mission.id,"approval",{requestId:"explicit-synthetic-probe-approval",expectedVersion:preview.version,decision:"APPROVED",proposalHash:approval.proposalHash},approval.id);
 await runMissionSlice({id:mission.id});const view=await missionDetail(user.id,mission.id);report.view=view;
 const step=view.steps.find(s=>s.toolName==="propose_metric_verification");if(step?.status!=="SUCCEEDED")throw new Error("JOB_NOT_SETTLED:"+JSON.stringify(view.error));report.status="REAL_CONTAINER_RECEIPT_RECORDED";
}catch(error){report.status="FAILED_OR_UNKNOWN";report.view={priorView:report.view,error:(error as Error).message};process.exitCode=1;}
finally{fs.writeFileSync(output,JSON.stringify(report,null,2));await db.$disconnect();console.log(JSON.stringify({status:report.status,output}));}
