import {createHash} from "node:crypto";
import {db} from "@/lib/db";
import {AppError} from "@/lib/api";
import type {Observation} from "./contracts";
import type {Tx} from "@/lib/mission/repository";
import {ownedMission} from "@/lib/mission/repository";
import {json} from "@/lib/mission/contracts";
export const textHash=(text:string)=>createHash("sha256").update(text).digest("hex");
export function observation(missionId:string,url:string,mode:Observation["retrievalMode"],title:string,content:string,publishedAt?:string|null):Observation{
 const normalized=content.normalize("NFKC").replace(/\r\n/g,"\n").trim();const text=normalized.slice(0,8000);const hash=textHash(text);
 return{id:`src_${textHash(`${missionId}:${url}:${mode}:${hash}`).slice(0,40)}`,requestedUrl:url,retrievalMode:mode,title:title.slice(0,300),publisher:new URL(url).hostname,publishedAt:publishedAt&&Number.isFinite(Date.parse(publishedAt))?new Date(publishedAt).toISOString():null,normalizedContentHash:hash,excerpt:{schemaVersion:1,text,start:0,end:text.length,truncated:normalized.length>text.length}};
}
export async function persistObservations(tx:Tx,missionId:string,data:unknown){
 const rows=(data as {observations?:Observation[]})?.observations??[];
 for(const r of rows){if(r.retrievalMode==="PROVIDER_EXTRACT")await tx.externalSource.updateMany({where:{missionId,requestedUrl:r.requestedUrl,retrievalMode:"PROVIDER_EXTRACT",normalizedContentHash:{not:r.normalizedContentHash}},data:{availability:"SUPERSEDED"}});await tx.externalSource.upsert({where:{id:r.id},create:{id:r.id,missionId,requestedUrl:r.requestedUrl,resolvedUrl:null,retrievalMode:r.retrievalMode,title:r.title,publisher:r.publisher,publishedAt:r.publishedAt?new Date(r.publishedAt):null,normalizedContentHash:r.normalizedContentHash,excerptJson:json(r.excerpt)},update:{availability:"AVAILABLE"}});
 }
}
export async function listSources(userId:string,missionId:string){await ownedMission(userId,missionId);return db.externalSource.findMany({where:{missionId},orderBy:{fetchedAt:"desc"},take:100});}
export async function readSource(userId:string,missionId:string,id:string){await ownedMission(userId,missionId);const source=await db.externalSource.findFirst({where:{id,missionId}});if(!source)throw new AppError("SOURCE_NOT_FOUND","资料不属于当前委托",404);return source;}
