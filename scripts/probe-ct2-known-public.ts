import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { isolatedContinuityEvaluation } from "./continuity-evaluation/environment";
const root=path.resolve("output/r4-continuity/ct2-public-20261029"),priorPath=path.join(root,"results.json"),out=path.join(root,"known-sha-results.json"),prior=JSON.parse(fs.readFileSync(priorPath,"utf8"));
const sha=process.argv[2];if(fs.existsSync(out)){const stopped=JSON.parse(fs.readFileSync(out,"utf8"));if(stopped.requests.length!==0||stopped.errors[0]!=="FOCUS_AGENT_DISABLED")throw new Error("PRIOR_KNOWN_SHA_PROBE_NOT_RESENT");fs.renameSync(out,path.join(root,"known-sha-precondition-failure.json"));}if(!/^[a-f0-9]{40}$/.test(sha??""))throw new Error("INVALID_KNOWN_SHA");
// Continue the original 12-request budget. The unknown list request is retained and never resent.
const report={kind:"LIVE_PUBLIC_KNOWN_SHA_SAME_BUDGET",priorReportHash:createHash("sha256").update(fs.readFileSync(priorPath)).digest("hex"),priorReserved:prior.reservedRequests as number,reservedRequests:prior.reservedRequests as number,maxRequests:12,sha,shaEvidence:"git ls-remote https://github.com/octokit/rest.js.git HEAD; recorded before this run",status:"STARTED",requests:[] as unknown[],observation:null as unknown,errors:[] as string[]};
if(!Number.isInteger(report.priorReserved)||report.priorReserved<1||report.priorReserved>12)throw new Error("PUBLIC_BUDGET_INVALID");fs.writeFileSync(out,JSON.stringify(report,null,2),{flag:"wx"});
isolatedContinuityEvaluation("ct2-public-known");const {db}=await import("../lib/db"),{createSession}=await import("../lib/auth/session"),{readRepositoryCi}=await import("../lib/sensing/repoCi");
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
try{
  const user=await db.user.create({data:{username:crypto.randomUUID(),displayName:"固定SHA公开探针",passwordHash:"unused"}}),p=await db.project.create({data:{title:"固定SHA真实传输",description:"synthetic project, live public transport",goal:"核对CI",scenario:"COMPETITION",memberships:{create:{userId:user.id}}}}),c=await db.sourceConnection.create({data:{projectId:p.id,ownerUserId:user.id,repo:"octokit/rest.js",ref:"main",signalKind:"COMMITS_AND_CI"}});
  report.observation=await readRepositoryCi({userId:user.id,sessionId:(await createSession(user.id)).session.id},p.id,c.id,sha,undefined,async(resource,units,run)=>{
    if(prior.requests.some((r:{resource:string})=>r.resource===resource))throw new Error("PRIOR_UNKNOWN_NOT_RESENT");
    if(report.reservedRequests+units>report.maxRequests)throw new Error("PUBLIC_BUDGET_EXHAUSTED");report.reservedRequests+=units;const r={resource,units,state:"DISPATCH_COMMITTED",httpStatus:null as number|null};report.requests.push(r);save();
    try{const response=await run();r.state="RECEIVED";r.httpStatus=response.status;save();return response;}catch(error){r.state="UNKNOWN";save();throw error;}
  });report.status="FIXED_SHA_METADATA_RECEIVED";
}catch(error){report.status="FAILED_OR_UNKNOWN";report.errors.push(String((error as {code?:string;cause?:{code?:string}}).code??(error as {cause?:{code?:string}}).cause?.code??"KNOWN_SHA_PROBE_FAILED"));process.exitCode=1;}
finally{save();await db.$disconnect();console.log(JSON.stringify({status:report.status,reservedRequests:report.reservedRequests,errors:report.errors}));}
