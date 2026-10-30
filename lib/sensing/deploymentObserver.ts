import {AppError} from "@/lib/api";
import {db} from "@/lib/db";
import {assertProject,record} from "@/lib/conversation/repository";
import type {ConversationActor} from "@/lib/types/conversation";
import {ownedMission} from "@/lib/mission/repository";
import {assertContinuityBinding,assertDirectiveEffect,effectiveContinuity} from "@/lib/continuity/directiveService";
import {assertSourceUse} from "@/lib/continuity/sourcePolicy";
import {deploymentConnection} from "./deploymentConnections";
import {deploymentTransport,type DeploymentTransport,type DeploymentHttpResult} from "./deploymentTransport";
import {deploymentLayers,redactDeploymentLog} from "./deploymentEvidence";
import type {CiDispatch,RepositoryActor} from "./repoCi";
import type {DeploymentSourceMeta} from "@/lib/types/deployment";

function healthBody(raw:unknown){
  const body=record(raw),status=String(body.status).toLowerCase();
  const release=typeof body.release==="string"?redactDeploymentLog(body.release).slice(0,80):null;
  const time=typeof body.checked_at==="string"?Date.parse(body.checked_at):NaN;
  return{status:["ok","pass","healthy","fail","failed","error","unhealthy"].includes(status)?status:"UNRECOGNIZED",
    release:release&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(release)?release:null,checked_at:Number.isFinite(time)?new Date(time).toISOString():null};
}
/** Called only from the original Turn/Step dispatch ledger. Raw response fields never enter the ledger or model. */
export async function readDeploymentObservation(actor:RepositoryActor,projectId:string,connectionId:string,kind:"STATUS"|"LOG",dispatch:CiDispatch,transport:DeploymentTransport=deploymentTransport){
  if(actor.sessionId){if((await assertProject(actor as ConversationActor,projectId)).role!=="OWNER")throw new AppError("CONNECTION_NOT_FOUND","环境连接不可访问",404);}
  else if(!actor.missionId||(await ownedMission(actor.userId,actor.missionId)).projectId!==projectId)throw new AppError("CONNECTION_NOT_FOUND","环境连接不可访问",404);
  const scope={projectId,...(actor.conversationId?{conversationId:actor.conversationId}:{}),...(actor.missionId?{missionId:actor.missionId}:{})};
  const original=await deploymentConnection(actor.userId,projectId,connectionId),continuity=await effectiveContinuity(actor.userId,scope);
  if(kind==="LOG"&&!original.config.logPath)throw new AppError("DEPLOYMENT_LOGS_NOT_APPROVED","该环境未获准读取日志",409);
  const guard=async()=>{
    const current=await deploymentConnection(actor.userId,projectId,connectionId);
    if(current.revision!==original.revision)throw new AppError("CONNECTION_CHANGED","环境身份或只读许可已变化",409);
    assertDirectiveEffect(await assertContinuityBinding(actor.userId,scope,continuity),"EXTERNAL_READ");
    await assertSourceUse(actor.userId,projectId,"connection:"+connectionId,db,scope);
  };
  const signal=AbortSignal.timeout(15000);
  let requestCount=0;
  const read=async(path:string,log=false):Promise<DeploymentHttpResult>=>{
    await guard();const url=new URL(path,original.config.origin).href;
    const r=await dispatch(url,1,async()=>{
      const response=await transport(url,signal),raw=record(response.body);
      const lines=Array.isArray(raw.lines)?raw.lines.filter((v):v is string=>typeof v==="string").slice(-200).join("\n"):"";
      return{status:response.status,observedAt:response.observedAt,body:{contentType:response.contentType,payload:log?{text:redactDeploymentLog(lines),hasStructuredLines:Array.isArray(raw.lines)}:healthBody(response.body)}};
    });
    requestCount++;await guard();const wrapped=record(r.body);
    return{status:r.status,contentType:String(wrapped.contentType??""),body:wrapped.payload,observedAt:r.observedAt??new Date().toISOString()};
  };
  const health=await read(kind==="LOG"?original.config.logPath!:original.config.healthPath,kind==="LOG");
  const userPath=kind==="STATUS"&&original.config.userPath?await read(original.config.userPath):undefined;
  const observedAt=health.observedAt,validUntil=new Date(Math.min(Date.parse(observedAt)+original.config.freshnessSeconds*1000,Date.parse(original.config.expiresAt))).toISOString();
  const metadata:DeploymentSourceMeta={connectionId,connectionRevision:original.row.revision,environment:original.config.environment,origin:original.config.origin,expectedRelease:original.config.expectedRelease,
    reportedRelease:kind==="STATUS"?healthBody(health.body).release:null,observedAt,validUntil,kind,...(actor.missionId?{missionId:actor.missionId}:{}),...(actor.conversationId?{conversationId:actor.conversationId}:{})};
  await guard();
  return{schemaVersion:1,metadata,layers:kind==="STATUS"?deploymentLayers(original.config,health,userPath):[],
    ...(kind==="LOG"?{log:{text:String(record(health.body).text??""),httpStatus:health.status,available:health.status===200&&record(health.body).hasStructuredLines===true,verification:"REDACTED_EXCERPT_REQUIRES_REVIEW"}}:{}),
    coverage:{complete:false,requestCount,buildObserved:false,deploymentReceiptObserved:false,authenticatedUserPathObserved:false,logsRead:kind==="LOG",description:"只覆盖获准的固定公共读取路径；服务自报不是用户授权、部署签收或行动完成"},
    authority:"UNTRUSTED_TOOL_DATA_NEVER_USER_DIRECTIVE"} as const;
}
