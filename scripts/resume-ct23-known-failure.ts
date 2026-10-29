import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { EvaluationBudget } from "./mission-evaluation/budget";
import { getChatProviderConfig } from "../lib/config/provider";
import { continuityRuntimeHashes } from "./continuity-evaluation/environment";
const root=path.resolve("output/r4-continuity/ct23-live-20261029"),priorPath=path.join(root,"results.json"),receipt=path.join(root,"known-recovery.json"),prior=JSON.parse(fs.readFileSync(priorPath,"utf8"));
if(fs.existsSync(receipt)||prior.budget.unknownUsageRequests!==0)throw new Error("RECOVERY_ALREADY_ATTEMPTED_OR_UNKNOWN");
const file=fs.realpathSync(prior.database);if(!file.startsWith(fs.realpathSync(os.tmpdir())+path.sep)||!/^pm-ct23-live-/.test(path.basename(path.dirname(file)))||path.basename(file)!=="evaluation.db")throw new Error("NOT_THE_PRIOR_ISOLATED_DATABASE");
Object.assign(process.env,{DATABASE_URL:"file:"+file.replaceAll("\\","/"),MISSION_ENABLED:"true",MISSION_WRITES_ENABLED:"true",MISSION_INVESTIGATION_DELEGATION_ENABLED:"true",REPO_CI_OBSERVER_ENABLED:"true",MISSION_WEB_ENABLED:"false",FOCUS_CONTINUITY_ENABLED:"true",SEMANTIC_MEMORY_ENABLED:"false",LLM_MODE:"openai-compatible"});
const config=getChatProviderConfig(),budget=await EvaluationBudget.acquire(path.join(root,"budget.json"),config,{live:true,maxRequests:24,maxCostCny:5}),originalFetch=globalThis.fetch;globalThis.fetch=budget.wrapFetch(originalFetch);
const {db}=await import("../lib/db"),{missionDetail,commandMission}=await import("../lib/mission/missionService"),{runMissionSlice}=await import("../lib/mission/runner"),{prepareActionResult,commitActionResult}=await import("../lib/services/actionService");
const report={kind:"KNOWN_FAILED_CITATION_SAME_MISSION_SAME_BUDGET",priorReportHash:createHash("sha256").update(fs.readFileSync(priorPath)).digest("hex"),sourceHashes:continuityRuntimeHashes(),status:"STARTED",results:[] as unknown[],budget:budget.summary()};fs.writeFileSync(receipt,JSON.stringify(report,null,2),{flag:"wx"});
const save=()=>{report.budget=budget.summary();fs.writeFileSync(receipt,JSON.stringify(report,null,2));};
try{
  for(const previous of prior.episodes.filter((e:{finalView?:{error?:{code:string}}})=>e.finalView?.error?.code==="EXACT_CITATION_REQUIRED")){
    const row=await db.agentMission.findUniqueOrThrow({where:{id:previous.missionId}}),usedBefore=row.budgetUsedJson;
    if(row.status!=="PAUSED"||(row.lastErrorJson as {code?:string})?.code!=="EXACT_CITATION_REQUIRED")throw new Error("NOT_A_KNOWN_CITATION_FAILURE");
    await commandMission(row.ownerUserId,row.id,"resume",{requestId:"known-citation-failure-resume",expectedVersion:row.version});
    for(let i=0;i<6;i++){
      if((await missionDetail(row.ownerUserId,row.id)).status!=="READY")break;
      budget.setScope(`FAILED_CI/known-citation-recovery-${i+1}`);
      await runMissionSlice({id:row.id,repository:async()=>{throw new Error("KNOWN_EVIDENCE_MUST_NOT_BE_FETCHED_AGAIN");}});
    }
    let view=await missionDetail(row.ownerUserId,row.id);let actionReceipt:unknown=null;
    if(view.status==="WAITING_APPROVAL"&&view.approvals[0]){const a=view.approvals[0];await commandMission(row.ownerUserId,row.id,"approval",{requestId:"recovered-explicit-approval",expectedVersion:view.version,decision:"APPROVED",proposalHash:a.proposalHash},a.id);await runMissionSlice({id:row.id});
      const action=await db.actionItem.findFirstOrThrow({where:{projectId:row.projectId}}),prepared=await prepareActionResult(row.projectId,action.id,"合成回执：已完成失败断言核对，仍无真实部署或设备验收记录。",true),result=await db.$transaction(tx=>commitActionResult(tx,prepared));actionReceipt={actionId:result.updatedAction.id,resultCardId:result.updatedAction.resultCardId,realWorldOutcome:false};
    }
    view=await missionDetail(row.ownerUserId,row.id);report.results.push({missionId:row.id,usedBefore,view,actionReceipt});save();
  }
  report.status="RECEIVED_FOR_TRACE_REVIEW";
}catch(error){report.status="FAILED_OR_UNKNOWN";report.results.push({code:String((error as {code?:string}).code??"RECOVERY_FAILED")});process.exitCode=1;}
finally{save();globalThis.fetch=originalFetch;await budget.close();await db.$disconnect();console.log(JSON.stringify({status:report.status,...budget.summary()}));}
