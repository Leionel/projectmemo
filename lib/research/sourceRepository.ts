import {createHash} from "node:crypto";
import {db} from "@/lib/db";
import {AppError} from "@/lib/api";
import type {Observation} from "./contracts";
import type {Tx} from "@/lib/mission/repository";
import {ownedMission} from "@/lib/mission/repository";
import {json} from "@/lib/mission/contracts";
export const textHash=(text:string)=>createHash("sha256").update(text).digest("hex");
export function observation(missionId:string,url:string,mode:Observation["retrievalMode"],title:string,content:string,publishedAt?:string|null,scopeRevision?:number):Observation{
 const normalized=content.normalize("NFKC").replace(/\r\n/g,"\n").trim();const text=normalized.slice(0,8000);const hash=textHash(text);
 return{id:`src_${textHash(`${missionId}:${url}:${mode}:${hash}${scopeRevision?":"+scopeRevision:""}`).slice(0,40)}`,requestedUrl:url,retrievalMode:mode,title:title.slice(0,300),publisher:new URL(url).hostname,publishedAt:publishedAt&&Number.isFinite(Date.parse(publishedAt))?new Date(publishedAt).toISOString():null,normalizedContentHash:hash,excerpt:{schemaVersion:1,...(scopeRevision?{scopeRevision}:{}),text,start:0,end:text.length,truncated:normalized.length>text.length}};
}
export async function persistObservations(tx:Tx,missionId:string,data:unknown){
 const rows=(data as {observations?:Observation[]})?.observations??[];
 const mission=rows.length?await tx.agentMission.findUniqueOrThrow({where:{id:missionId},select:{researchScopeVersion:true}}):null;
 for(const r of rows){if(r.retrievalMode==="PROVIDER_EXTRACT")await tx.externalSource.updateMany({where:{missionId,requestedUrl:r.requestedUrl,retrievalMode:"PROVIDER_EXTRACT",normalizedContentHash:{not:r.normalizedContentHash}},data:{availability:"SUPERSEDED"}});await tx.externalSource.upsert({where:{id:r.id},create:{id:r.id,missionId,requestedUrl:r.requestedUrl,resolvedUrl:null,retrievalMode:r.retrievalMode,title:r.title,publisher:r.publisher,...(r.observedAt?{fetchedAt:new Date(r.observedAt)}:{}),publishedAt:r.publishedAt?new Date(r.publishedAt):null,normalizedContentHash:r.normalizedContentHash,excerptJson:json({...r.excerpt,scopeRevision:r.excerpt.scopeRevision??mission!.researchScopeVersion})},update:{availability:"AVAILABLE"}});
 }
}
export async function listSources(userId:string,missionId:string){
 const m=await ownedMission(userId,missionId),rows=await db.externalSource.findMany({where:{missionId},orderBy:{fetchedAt:"desc"},take:100}),{sourceUse}=await import("@/lib/continuity/sourcePolicy");
 return Promise.all(rows.map(async s=>{const policy=await sourceUse(userId,m.projectId,s.id,db,{missionId});return policy.state==="ALLOWED"?s:{...s,availability:policy.reason==="SOURCE_SCOPE_CHANGED"?"SCOPE_CHANGED":policy.state};}));
}
export async function readSource(userId:string,missionId:string,id:string){await ownedMission(userId,missionId);const source=await db.externalSource.findFirst({where:{id,missionId}});if(!source)throw new AppError("SOURCE_NOT_FOUND","资料不属于当前委托",404);return source;}
