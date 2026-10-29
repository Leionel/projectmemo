import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash, type Source } from "./contracts";
import { assertOwner, event, lock, sourceHash, type Tx } from "./repository";
import type { WaitState } from "./gaps";

export type MaterialCoverage = { loadedCharacters: number; totalCharacters: number; truncated: boolean; extractionStatus: string };
export type ProjectMaterialView = { source: Source; title: string; coverage: MaterialCoverage };
export async function readProjectMaterial(projectId: string, id: string, tx: Tx = db): Promise<Source | null> {
  return (await readProjectMaterialView(projectId, id, tx))?.source ?? null;
}
/** Metadata for readers only. The source identity and 12k body are unchanged. */
export async function readProjectMaterialView(projectId: string, id: string, tx: Tx = db): Promise<ProjectMaterialView | null> {
  if (id.startsWith("capture:")) {
    const row = await tx.capture.findFirst({where:{id:id.slice(8),projectId},include:{card:{select:{id:true}}}});
    if (!row) return null;
    const cardHash=row.card?await sourceHash(projectId,`card:${row.card.id}`,tx):null;
    const hash=jsonHash({rawText:row.rawText,sourceType:row.sourceType,cardHash});
    const text = row.rawText.slice(0,12000);
    return { source: {id,kind:"PROJECT",entityType:"CAPTURE",revision:hash,hash,text,observedAt:row.createdAt.toISOString()},
      title: row.rawText.split(/\r?\n/,1)[0].slice(0,80) || row.sourceType || "项目记录",
      coverage: {loadedCharacters:text.length,totalCharacters:row.rawText.length,truncated:text.length<row.rawText.length,extractionStatus:"SUCCESS"} };
  }
  if (id.startsWith("attachment:")) {
    const row=await tx.attachment.findFirst({where:{id:id.slice(11),projectId},include:{cards:{select:{id:true},orderBy:{id:"asc"}},revisions:{orderBy:[{revisionIndex:"desc"},{id:"desc"}],take:1}}});
    if(!row)return null;
    const revision=row.revisions[0];
    const text=row.extractionStatus==="SUCCESS"?(revision?.text??row.extractedText??""):"";
    const cardHashes=await Promise.all(row.cards.map(c=>sourceHash(projectId,`card:${c.id}`,tx)));
    const hash=jsonHash({sha256:row.sha256,status:row.extractionStatus,revisionId:revision?.id??null,text,cardHashes});
    return { source: {id,kind:"PROJECT",entityType:"ATTACHMENT",revision:revision?.id??hash,hash,text:text.slice(0,12000),observedAt:(revision?.createdAt??row.createdAt).toISOString()}, title:row.fileName,
      coverage:{loadedCharacters:Math.min(text.length,12000),totalCharacters:text.length,truncated:text.length>12000,extractionStatus:row.extractionStatus} };
  }
  return null;
}

/** Durable, bounded cyclic scan. Re-scans overlap rather than trusting callback delivery or commit order. */
export async function scanWaitingMaterialBatch(limit=8) {
  if(!isFeatureEnabled("MISSION_ENABLED",false)||!isFeatureEnabled("MISSION_EVENT_CONTINUATION_ENABLED",false))return {signals:0,missionIds:[] as string[]};
  const missions=await db.agentMission.findMany({where:{status:"WAITING_INPUT",cancelRequestedAt:null,pauseRequestedAt:null},orderBy:{updatedAt:"asc"},take:limit});
  let signals=0;
  for(const candidate of missions)await db.$transaction(async tx=>{
    await lock(tx,candidate.id);const m=await tx.agentMission.findUniqueOrThrow({where:{id:candidate.id}});
    if(m.status!=="WAITING_INPUT"||m.cancelRequestedAt||m.pauseRequestedAt)return;
    try{await assertOwner(m.ownerUserId,m.projectId,tx);}catch{return;}
    const wait=m.waitStateJson as unknown as WaitState|null;if(!wait?.startedAt||!wait.questionId)return;
    const since=new Date(new Date(wait.startedAt).getTime()-300000),cursor=wait.sourceCursor??{capture:"",attachment:""};
    const captures=await tx.capture.findMany({where:{projectId:m.projectId,createdAt:{gte:since},id:{gt:cursor.capture}},orderBy:{id:"asc"},take:20});
    // Existing attachments may receive a new extraction/correction after the wait started.
    const attachments=await tx.attachment.findMany({where:{projectId:m.projectId,id:{gt:cursor.attachment},OR:[{createdAt:{gte:since}},{revisions:{some:{createdAt:{gte:since}}}}]},orderBy:{id:"asc"},take:20});
    for(const id of [...captures.map(c=>`capture:${c.id}`),...attachments.map(a=>`attachment:${a.id}`)]){
      const source=await readProjectMaterial(m.projectId,id,tx);if(!source)continue;
      const key=`source:${wait.questionId}:${source.id}:${source.hash}`;
      if(await tx.agentMissionEvent.findUnique({where:{missionId_commandRequestId:{missionId:m.id,commandRequestId:key}}}))continue;
      await event(tx,m.id,"SOURCE_ARRIVED",{questionId:wait.questionId,sourcePointer:{id:source.id,hash:source.hash},readable:!!source.text.trim(),observedAt:source.observedAt},{id:key,hash:jsonHash(source)});signals++;
    }
    await tx.agentMission.update({where:{id:m.id},data:{waitStateJson:json({...wait,sourceCursor:{capture:captures.length===20?captures.at(-1)!.id:"",attachment:attachments.length===20?attachments.at(-1)!.id:""}})}});
  });
  return {signals,missionIds:missions.map(m=>m.id)};
}

export async function scanWaitingMaterials(limit=8){return(await scanWaitingMaterialBatch(limit)).signals;}
