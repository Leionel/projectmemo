import {db} from "@/lib/db";
import {AppError} from "@/lib/api";
import {isFeatureEnabled} from "@/lib/config/features";
import {json,jsonHash} from "@/lib/mission/contracts";
import {record,type Tx} from "@/lib/conversation/repository";
import {writeTransaction} from "@/lib/copilot/confirmation";
import {createDeploymentSchema,deploymentConfigSchema,deploymentControlSchema} from "@/lib/types/deployment";

export function requireDeployment(){if(!isFeatureEnabled("DEPLOYMENT_OBSERVER_ENABLED",false))throw new AppError("DEPLOYMENT_OBSERVER_DISABLED","部署观察当前未开启",503);}
async function owner(tx:Tx,userId:string,projectId:string){if(!await tx.projectMembership.findFirst({where:{userId,projectId,role:"OWNER"}}))throw new AppError("CONNECTION_NOT_FOUND","环境连接不可访问",404);}
function period(expiresAt:string){if(Date.parse(expiresAt)<=Date.now()||Date.parse(expiresAt)>Date.now()+30*86400000)throw new AppError("INVALID_DEPLOYMENT_PERIOD","请选择未来30天内的只读观察期限",422);}
function view(row:{id:string;revision:number;status:string;deploymentConfigJson:unknown;revokedAt:Date|null}){
  return{id:row.id,revision:row.revision,status:row.status,config:deploymentConfigSchema.parse(row.deploymentConfigJson),revokedAt:row.revokedAt?.toISOString()??null};
}
export async function listDeploymentConnections(userId:string,projectId:string){
  await owner(db,userId,projectId);
  const rows=await db.sourceConnection.findMany({where:{ownerUserId:userId,projectId,provider:"DEPLOYMENT"},orderBy:{createdAt:"asc"}});
  const {latestDeploymentObservation}=await import("./deploymentObservations");
  return{enabled:isFeatureEnabled("DEPLOYMENT_OBSERVER_ENABLED",false),connections:await Promise.all(rows.map(async row=>({...view(row),latest:await latestDeploymentObservation(userId,projectId,row.id)})))};
}
/** No network on grant; original AgentRun is the idempotent authorization receipt. */
export async function createDeploymentConnection(userId:string,projectId:string,raw:unknown){
  requireDeployment();const input=createDeploymentSchema.parse(raw),hash=jsonHash({projectId,input}),receiptId="deployment-grant:"+jsonHash({userId,requestId:input.requestId});
  return writeTransaction("deployment-grant:"+projectId,async tx=>{
    await tx.user.updateMany({where:{id:userId},data:{continuitySeq:{increment:0}}});await owner(tx,userId,projectId);
    const prior=await tx.agentRun.findUnique({where:{id:receiptId}});
    if(prior){if(record(prior.trace).hash!==hash)throw new AppError("REQUEST_ID_REUSED","请求编号已用于另一项环境授权",409);return prior.resultJson;}
    period(input.config.expiresAt);
    if(await tx.sourceConnection.count({where:{projectId,provider:"DEPLOYMENT",status:"ACTIVE"}})>=3)throw new AppError("CONNECTION_LIMIT","每个项目最多三个活跃环境连接",409);
    if(await tx.sourceConnection.findUnique({where:{projectId_provider_environmentKey:{projectId,provider:"DEPLOYMENT",environmentKey:input.config.environment}}}))throw new AppError("DEPLOYMENT_ENVIRONMENT_EXISTS","同名环境已存在，请核对原连接",409);
    const row=await tx.sourceConnection.create({data:{projectId,ownerUserId:userId,provider:"DEPLOYMENT",environmentKey:input.config.environment,deploymentConfigJson:json(input.config),repo:null,ref:null,signalKind:input.config.logPath?"DEPLOYMENT_HEALTH_LOGS":"DEPLOYMENT_HEALTH",revision:1}}),result={connection:view(row)};
    await tx.agentRun.create({data:{id:receiptId,projectId,runType:"CHAT",status:"SUCCESS",provider:"USER_CONFIRMED_CONNECTION_CONTROL",trace:json({hash,userId,connectionId:row.id,kind:"DEPLOYMENT_READ_GRANT",externalWrites:false}),resultJson:json(result)}});
    return result;
  });
}
export async function controlDeploymentConnection(userId:string,projectId:string,connectionId:string,raw:unknown){
  const input=deploymentControlSchema.parse(raw),hash=jsonHash({projectId,connectionId,input}),receiptId="deployment-control:"+jsonHash({userId,requestId:input.requestId});
  return writeTransaction("deployment-control:"+connectionId,async tx=>{
    await tx.user.updateMany({where:{id:userId},data:{continuitySeq:{increment:0}}});await owner(tx,userId,projectId);
    const row=await tx.sourceConnection.findFirst({where:{id:connectionId,ownerUserId:userId,projectId,provider:"DEPLOYMENT"}});
    if(!row)throw new AppError("CONNECTION_NOT_FOUND","环境连接不可访问",404);
    const prior=await tx.agentRun.findUnique({where:{id:receiptId}});
    if(prior){if(record(prior.trace).hash!==hash)throw new AppError("REQUEST_ID_REUSED","请求编号已用于其他操作",409);return prior.resultJson;}
    if(row.revision!==input.expectedVersion)throw new AppError("CONNECTION_CHANGED","环境权限已变化，请重新核对",409);
    if(input.action==="REVISE"){
      requireDeployment();period(input.config.expiresAt);
      if(row.status!=="ACTIVE"||row.revokedAt)throw new AppError("CONNECTION_REVOKED","撤销的环境连接不能自动恢复，请明确新建连接",409);
      if(input.config.environment!==row.environmentKey)throw new AppError("DEPLOYMENT_IDENTITY_CHANGED","环境名属于连接身份，换环境请新建连接",409);
    }
    const updated=await tx.sourceConnection.update({where:{id:row.id},data:input.action==="REVOKE"?{status:"REVOKED",revokedAt:row.revokedAt??new Date(),revision:{increment:1}}:{deploymentConfigJson:json(input.config),signalKind:input.config.logPath?"DEPLOYMENT_HEALTH_LOGS":"DEPLOYMENT_HEALTH",revision:{increment:1}}}),result={connection:view(updated)};
    await tx.agentRun.create({data:{id:receiptId,projectId,runType:"CHAT",status:"SUCCESS",provider:"USER_CONFIRMED_CONNECTION_CONTROL",trace:json({hash,userId,connectionId,kind:input.action==="REVOKE"?"DEPLOYMENT_READ_REVOKED":"DEPLOYMENT_READ_REVISED"}),resultJson:json(result)}});
    return result;
  });
}
export async function deploymentConnection(userId:string,projectId:string,id:string,tx:Tx=db){
  requireDeployment();await owner(tx,userId,projectId);
  const row=await tx.sourceConnection.findFirst({where:{id,projectId,ownerUserId:userId,provider:"DEPLOYMENT",status:"ACTIVE",revokedAt:null}});
  if(!row)throw new AppError("CONNECTION_NOT_FOUND","环境连接已撤销或不可访问",404);
  const config=deploymentConfigSchema.parse(row.deploymentConfigJson);
  if(Date.parse(config.expiresAt)<=Date.now())throw new AppError("DEPLOYMENT_GRANT_EXPIRED","环境只读许可已到期",409);
  return{row,config,revision:jsonHash({connectionId:id,revision:row.revision,config})};
}
