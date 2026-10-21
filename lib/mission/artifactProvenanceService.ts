import { materialTemporalStates } from "./readSetValidator";
import { db } from "@/lib/db";
import { jsonHash,type Source } from "./contracts";
import { sourceHash,type Tx } from "./repository";
import type { MissionArtifactAudit } from "@/lib/types/missionArtifacts";
export async function missionArtifactAudit(projectId:string,artifactId:string,tx:Tx=db,depth=0):Promise<MissionArtifactAudit|null>{
 let r;
 try{r=await tx.missionArtifactReceipt.findFirst({where:{artifactId,projectId}});}catch(error){
  // Before the additive M3 migration, legacy Artifact audit still has its original schema.
  if((error as {code?:string}).code==="P2021")return null;
  throw error;
 }
 if(!r)return null;
 const sources=r.sourceManifestJson as unknown as MissionArtifactAudit["sources"],states=new Map<string,"STALE"|"UNKNOWN"|"NOT_CHECKED"|"CONFLICT">();
 for(const s of sources){
  if(depth>8){states.set(s.id,"UNKNOWN");continue;}
  if(s.entityType==="ARTIFACT"){
   const row=await tx.generatedArtifact.findFirst({where:{id:s.id.slice(9),projectId}});
   const audit=row?await missionArtifactAudit(projectId,row.id,tx,depth+1):null;
   states.set(s.id,!row?"STALE":jsonHash({content:row.content,audit:audit?.blocks??[]})!==s.hash?"STALE":"NOT_CHECKED");
  }else if(s.kind==="EXTERNAL"){
   const source=await tx.externalSource.findFirst({where:{id:s.id,missionId:r.missionId}});
   states.set(s.id,!source?"UNKNOWN":source.availability!=="AVAILABLE"||source.normalizedContentHash!==s.hash?"STALE":"NOT_CHECKED");
  }else states.set(s.id,await sourceHash(projectId,s.id,tx)!==s.hash?"STALE":"NOT_CHECKED");
 }
 const temporal=await materialTemporalStates(projectId,sources as Source[],tx);for(const item of temporal)if(["SUPERSEDED","CONTESTED"].includes(item.state))for(const id of item.sourceIds)states.set(id,"CONFLICT");
 const blocks=(r.blockMapJson as unknown as MissionArtifactAudit["blocks"]).map(b=>({...b,state:b.sourceIds.some(id=>states.get(id)==="STALE")?"STALE" as const:b.sourceIds.some(id=>states.get(id)==="CONFLICT")?"CONFLICT" as const:b.sourceIds.some(id=>!states.has(id)||states.get(id)==="UNKNOWN")?"UNKNOWN" as const:"NOT_CHECKED" as const}));
 return{receiptId:r.id,missionId:r.missionId,outputId:r.outputId,outputRevision:r.outputRevision,verification:"NOT_CHECKED",blocks,sources};
}
export async function artifactSourceHash(projectId:string,id:string,tx:Tx=db){const row=await tx.generatedArtifact.findFirst({where:{id,projectId}});if(!row)return null;const audit=await missionArtifactAudit(projectId,id,tx);return jsonHash({content:row.content,audit:audit?.blocks??[]});}
export async function searchAdoptedArtifacts(projectId:string,query:string,limit:number){
 const rows=await db.generatedArtifact.findMany({where:{projectId,content:{contains:query},missionReceipt:{isNot:null}},orderBy:{createdAt:"desc"},take:limit});const sources:Source[]=[];const results=[];
 for(const row of rows){const audit=await missionArtifactAudit(projectId,row.id),hash=await artifactSourceHash(projectId,row.id);sources.push({id:`artifact:${row.id}`,kind:"PROJECT",entityType:"ARTIFACT",knowledgeClass:audit?.blocks.every(b=>b.kind==="PROJECT_OBSERVATION")?"PROJECT_OBSERVATION":audit?.blocks.every(b=>b.kind==="EXTERNAL_REFERENCE")?"EXTERNAL_REFERENCE":"MIXED",revision:row.id,hash:hash!,text:row.content.slice(0,12000),observedAt:new Date().toISOString()});results.push({artifactId:row.id,content:row.content.slice(0,1500),audit});}
 return{sources,results};
}
