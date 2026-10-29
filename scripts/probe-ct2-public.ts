import fs from "node:fs";
import path from "node:path";
import { isolatedContinuityEvaluation,continuityRuntimeHashes } from "./continuity-evaluation/environment";
const root=path.resolve("output/r4-continuity/ct2-public-20261029");fs.mkdirSync(root,{recursive:true});
const reportPath=path.join(root,"results.json");if(fs.existsSync(reportPath))throw new Error("PUBLIC_PROBE_ALREADY_ATTEMPTED_NO_RESEND");
const environment=isolatedContinuityEvaluation("ct2-public"),report={kind:"LIVE_PUBLIC_GITHUB_ISOLATED_DB",sourceHashes:continuityRuntimeHashes(),database:environment.file,status:"STARTED",maxRequests:12,reservedRequests:0,requests:[] as unknown[],statusObservation:null as unknown,jobObservation:null as unknown,logCoverage:null as unknown,errors:[] as string[]};
fs.writeFileSync(reportPath,JSON.stringify(report,null,2),{flag:"wx"});
const {db}=await import("../lib/db"),{createSession}=await import("../lib/auth/session"),{ciTransport,readRepositoryCi,readRepositoryCiDetail}=await import("../lib/sensing/repoCi");
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const dispatch=async(resource:string,units:number,run:()=>Promise<import("../lib/sensing/repoCi").CiHttpResult>)=>{
  if(report.reservedRequests+units>report.maxRequests)throw new Error("PUBLIC_PROBE_BUDGET_EXHAUSTED");report.reservedRequests+=units;const row={resource,units,state:"DISPATCH_COMMITTED",httpStatus:null as number|null};report.requests.push(row);save();
  try{const result=await run();row.state="RECEIVED";row.httpStatus=result.status;save();return result;}catch(error){row.state="UNKNOWN";save();throw error;}
};
try{
  const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"公开 CI 隔离探针",passwordHash:"unused"}}),actor={userId:user.id,sessionId:(await createSession(user.id)).session.id};
  const p=await db.project.create({data:{title:"公开 CI 传输探针",description:"isolated synthetic project",goal:"核对固定 SHA",scenario:"COMPETITION",memberships:{create:{userId:user.id}}}}),c=await db.sourceConnection.create({data:{projectId:p.id,ownerUserId:user.id,repo:"octokit/rest.js",ref:"main",signalKind:"COMMITS_CI_LOGS"}});
  const first=await dispatch("https://api.github.com/repos/octokit/rest.js/commits?per_page=1",1,()=>ciTransport("https://api.github.com/repos/octokit/rest.js/commits?per_page=1",AbortSignal.timeout(15000)));
  const sha=(first.body as Array<{sha:string}>)[0]?.sha;if(first.status!==200||!sha)throw new Error("PUBLIC_COMMIT_NOT_OBSERVED");
  const status=await readRepositoryCi(actor,p.id,c.id,sha,undefined,dispatch);report.statusObservation=status;save();
  const run=status.runs.find(r=>r.conclusion==="failure")??status.runs[0];
  if(run){const parent={connectionId:c.id,connectionRevision:c.revision,repo:c.repo,sha,observedAt:status.observedAt,kind:"STATUS" as const,runs:status.runs};const jobs=await readRepositoryCiDetail(actor,p.id,parent,{runId:run.id,attempt:run.attempt},undefined,dispatch);report.jobObservation=jobs;save();
    const failed=jobs.repository.jobs?.find(j=>["failure","timed_out","cancelled"].includes(j.conclusion??""));
    if(failed){try{const log=await readRepositoryCiDetail(actor,p.id,jobs.repository,{jobId:failed.id},undefined,dispatch);report.logCoverage=log.coverage;}catch(error){report.errors.push(String((error as {code?:string}).code??"LOG_UNAVAILABLE"));}}
  }
  report.status="METADATA_RECEIVED_LOG_COVERAGE_SEPARATE";
}catch(error){report.status="FAILED_OR_UNKNOWN";report.errors.push(String((error as {code?:string}).code??"PUBLIC_PROBE_FAILED"));process.exitCode=1;}
finally{save();await db.$disconnect();console.log(JSON.stringify({status:report.status,reservedRequests:report.reservedRequests,errors:report.errors,reportPath}));}
