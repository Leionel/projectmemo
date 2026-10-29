import { afterAll,expect,test,vi } from "vitest";
const isolated=await vi.hoisted(async()=>(await import("./helpers/continuityDatabase")).continuityDatabase("experiment-metrics"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { parseMetricRecords,compareMetricRecords,type MetricRecord } from "@/lib/experiments/metrics";
import { inspectMetricTable } from "@/lib/experiments/table";
import { createMission,missionDetail,commandMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import type { Choice } from "@/lib/mission/contracts";
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
const row:MetricRecord={runId:"baseline",method:"A",metric:"accuracy",value:0.8,unit:"ratio",period:"2026-10-29",direction:"HIGHER_BETTER",dataset:"D@sha256",split:"test@sha256",seed:"42",evaluationCode:"eval@sha256",environment:"CPU@env",phase:"inference",batchSize:"1"};
test("nested JSON paths cannot overwrite a literal column with the same name",()=>{
 expect(()=>inspectMetricTable(JSON.stringify([{run:"a","metrics.accuracy":0.8,metrics:{accuracy:0.9}}]),"JSON")).toThrow();
});
test("metrics compare exact conditions, zero and negative results without declaring reproduction",()=>{
 expect(compareMetricRecords(row,{...row,runId:"candidate",method:"B",value:0.7})).toMatchObject({state:"SAME_CONDITIONS",improvement:"REGRESSED",verification:"REPORTED_INPUTS_NOT_REPRODUCED"});
 expect(compareMetricRecords(row,{...row,runId:"candidate"})).toMatchObject({delta:0,improvement:"UNCHANGED"});
 for(const key of ["dataset","split","seed","evaluationCode","environment","phase","batchSize","unit","period"] as const)expect(compareMetricRecords(row,{...row,[key]:"different"})).toMatchObject({state:"NOT_COMPARABLE",delta:null,mismatched:[key]});
 expect(compareMetricRecords(row,{...row,seed:null})).toMatchObject({state:"NOT_COMPARABLE",unknown:["seed"],delta:null});
});
test("CSV preserves quoted cells and rejects duplicate headers, duplicate runs and malformed values",()=>{
 const input={...row,method:'A, quoted "method"'},keys=Object.keys(input),csv=[keys.join(","),Object.values(input).map(v=>'"'+String(v).replaceAll('"','""')+'"').join(",")].join("\r\n");
 expect(parseMetricRecords(csv,"CSV")).toEqual([input]);
 for(const raw of [JSON.stringify([row,row]),JSON.stringify([{...row,value:null}]),JSON.stringify([{...row,unit:undefined}])])expect(()=>parseMetricRecords(raw,"JSON")).toThrow();
 expect(()=>parseMetricRecords(csv.replace("method","runId"),"CSV")).toThrow();expect(()=>parseMetricRecords("x".repeat(65537),"CSV")).toThrow();
});
test("original Mission reads captures, stores comparison and invalidates an old proposal after source revision",async()=>{
 process.env.EXPERIMENT_OBSERVER_ENABLED="true";
 const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"合成实验用户",passwordHash:"unused"}}),project=await db.project.create({data:{title:"指标比较",description:"ISOLATED_SYNTHETIC",goal:"核对同条件指标后选择下一步",scenario:"RESEARCH",memberships:{create:{userId:user.id}}}});
 const capture=await db.capture.create({data:{projectId:project.id,rawText:JSON.stringify([row,{...row,runId:"candidate",method:"B",value:0.7}]),sourceType:"EXPERIMENT_METRICS"}}),sourceId="capture:"+capture.id,revision=(await sourceHash(project.id,sourceId))!;
 const mission=await createMission(user.id,{projectId:project.id,requestId:"metrics",goal:"比较原指标，给出待确认的核对行动",llmContextApproved:true});
 const run=async(choice:Choice)=>runMissionSlice({id:mission.id,provider:async()=>({choice,provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 await run({kind:"tool",tool:"compare_experiment_metrics",args:{sourceId,revision,format:"JSON",leftRun:"baseline",rightRun:"candidate",metric:"accuracy"},summary:"比较同条件原记录"});
 const step=await db.agentMissionStep.findFirstOrThrow({where:{missionId:mission.id,toolName:"compare_experiment_metrics"}});expect(step.status,JSON.stringify(step.resultJson)).toBe("SUCCEEDED");expect(step.resultJson).toMatchObject({data:{comparison:{improvement:"REGRESSED"},execution:"NO_JOB_EXECUTED"}});
 await run({kind:"tool",tool:"propose_action",args:{title:"核对候选方法的下降原因",description:"先复核原记录，不自动训练"},summary:"保留负结果，提供下一步"});
 const view=await missionDetail(user.id,mission.id);expect(view.status).toBe("WAITING_APPROVAL");await db.capture.update({where:{id:capture.id},data:{rawText:JSON.stringify([row])}});
 await expect(commandMission(user.id,mission.id,"approval",{requestId:"old-approval",expectedVersion:view.version,decision:"APPROVED",proposalHash:view.approvals[0].proposalHash},view.approvals[0].id)).rejects.toThrow();expect(await db.actionItem.count({where:{projectId:project.id}})).toBe(0);
});
