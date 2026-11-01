import {randomUUID} from "node:crypto";
import {AppError} from "@/lib/api";
import {jsonHash} from "@/lib/mission/contracts";
import {sourceHash} from "@/lib/mission/repository";
import {readDeploymentObservation} from "@/lib/sensing/deploymentObserver";
import type {DeploymentTransport} from "@/lib/sensing/deploymentTransport";
import type {DeploymentCall} from "@/lib/types/deployment";
import type {ConversationActor,ConversationSource} from "@/lib/types/conversation";
import type {MaterialPointer} from "./toolAdapter";
import {record} from "./repository";
import {mutateTurn,turnOperation} from "./turnRuntime";
import {validateDeploymentObservation} from "@/lib/sensing/deploymentObservations";

export async function readConversationDeploymentTool(actor:ConversationActor,id:string,turnId:string,call:DeploymentCall,pointers:MaterialPointer[],transport?:DeploymentTransport){
  const pointer=pointers.find(p=>p.projectId===call.projectId&&p.sourceId==="connection:"+call.connectionId&&p.revision===call.revision);
  if(!pointer||await sourceHash(call.projectId,pointer.sourceId)!==call.revision)throw new AppError("CONNECTION_CHANGED","请从本轮已定位的环境许可中选择观察对象",409);
  let seq=0;
  const observation=await readDeploymentObservation({...actor,conversationId:id},call.projectId,call.connectionId,call.tool==="inspect_deployment"?"STATUS":"LOG",
    (url,requestUnits,run)=>turnOperation(actor,id,turnId,"deployment-http:"+jsonHash({call,seq:++seq}),"DEPLOYMENT_HTTP",{url,requestUnits},run),transport);
  const deployment={...observation.metadata,conversationId:id,turnId},text=JSON.stringify({authority:observation.authority,layers:observation.layers,coverage:observation.coverage,...("log" in observation?{log:observation.log}:{}),metadata:deployment}),revision=jsonHash({deployment,text}),sourceId="deploy:"+randomUUID();
  const source:ConversationSource={id:call.projectId+"/"+sourceId,projectId:call.projectId,sourceId,revision,deployment,title:`${deployment.environment} · ${deployment.kind} · ${deployment.expectedRelease}`,excerpt:text,observedAt:deployment.observedAt,
    temporalState:"UNKNOWN",knowledgeClass:"EXTERNAL_REFERENCE",start:0,end:text.length,excerptHash:jsonHash(text),readScope:deployment.kind==="LOG"?"EXCERPT":"STRUCTURED"};
  await mutateTurn(actor,id,turnId,manifest=>({...manifest,deploymentSources:[...(Array.isArray(record(manifest).deploymentSources)?record(manifest).deploymentSources as ConversationSource[]:[]),source].slice(-12)}));
  await validateDeploymentObservation(actor.userId,call.projectId,sourceId,revision);
  return{data:observation,sources:[source],coverage:observation.coverage,discovered:[] as MaterialPointer[]};
}
