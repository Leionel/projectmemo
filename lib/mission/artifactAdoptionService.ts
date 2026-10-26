import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { saveArtifactInTx } from "@/lib/repositories/artifacts";
import { json,jsonHash,type Source } from "./contracts";
import { validateResearchOutput } from "./researchOutputSchema";
import { outputSchema } from "./tools";
import { event,lock,ownedMission,validateSources,type Tx } from "./repository";
const previewSchema=z.object({artifactType:z.literal("weekly_report").default("weekly_report"),expectedOutputRevision:z.number().int().positive()}).strict();
const confirmSchema=previewSchema.extend({requestId:z.string().min(1).max(128),previewHash:z.string(),expectedContextVersion:z.number().int().positive()}).strict();
function enabled(){if(!isFeatureEnabled("MISSION_ARTIFACT_ADOPTION_ENABLED",false))throw new AppError("ADOPTION_DISABLED","成果归入暂未启用",503);}
async function prepare(userId:string,id:string,outputId:string,body:z.infer<typeof previewSchema>,tx:Tx){
 const m=await ownedMission(userId,id,tx);if(m.status==="CANCELLED"||m.cancelRequestedAt)throw new AppError("MISSION_CHANGED","委托已取消",409);
 const output=await tx.agentMissionOutput.findFirst({where:{id:outputId,missionId:id,revision:body.expectedOutputRevision}});if(!output)throw new AppError("OUTPUT_CHANGED","草稿版本已变化",409);
 const content=outputSchema.parse(output.contentJson),sources=output.sourceRefsJson as unknown as Source[];await validateSources(m.projectId,sources,tx,id);validateResearchOutput(content,sources);
 const sourceManifest=[...new Map(sources.map(s=>[s.id,{id:s.id,kind:s.kind,entityType:s.entityType,revision:s.revision,hash:s.hash,observedAt:s.observedAt,...(s.knowledgeClass?{knowledgeClass:s.knowledgeClass}:{}),...(s.kind==="EXTERNAL"?{url:s.identityKey}:{}),excerpts:content.blocks.flatMap(b=>b.citations.filter(c=>c.sourceId===s.id).map(c=>s.text.slice(c.start,c.end)))}])).values()];
 const blockMap=content.blocks.map(b=>({blockId:b.blockId,kind:b.kind,sourceIds:b.sourceIds,state:"NOT_CHECKED"}));
 const value={schemaVersion:1,missionId:id,outputId,outputRevision:output.revision,outputHash:jsonHash({content:output.contentJson,sources:output.sourceRefsJson,checks:output.claimChecksJson}),contextVersion:m.contextVersion,artifactType:body.artifactType,content:content.blocks.map(b=>b.text).join("\n\n"),sourceManifest,blockMap,verification:{status:output.verificationStatus,claims:output.claimChecksJson},visibility:"本项目有权查看成果的成员；不共享原委托私有对话或未选入来源",factConfirmation:false};
 return{m,value,previewHash:jsonHash(value)};
}
export async function previewArtifactAdoption(userId:string,id:string,outputId:string,raw:unknown){enabled();return db.$transaction(async tx=>{const a=await prepare(userId,id,outputId,previewSchema.parse(raw),tx);return{...a.value,previewHash:a.previewHash};});}
export async function confirmArtifactAdoption(userId:string,id:string,outputId:string,raw:unknown,transaction?:Tx){
 enabled();const body=confirmSchema.parse(raw),hash=jsonHash({id,outputId,body});
 const apply=async (tx:Tx)=>{
  await lock(tx,id);const m=await ownedMission(userId,id,tx);
  const commandKey=`artifact:${userId}:${body.requestId}`;
  const prior=await tx.agentMissionEvent.findFirst({where:{commandRequestId:commandKey}});
  if(prior){if(prior.commandPayloadHash!==hash)throw new AppError("REQUEST_ID_REUSED","请求编号已用于其他归入",409);return tx.missionArtifactReceipt.findUniqueOrThrow({where:{id:(prior.payloadJson as {receiptId:string}).receiptId}});}
  const replay=await tx.missionArtifactReceipt.findUnique({where:{createdByUserId_requestId:{createdByUserId:userId,requestId:body.requestId}}});
  if(replay){if(replay.payloadHash!==hash)throw new AppError("REQUEST_ID_REUSED","请求编号已用于其他归入",409);return replay;}
  const a=await prepare(userId,id,outputId,body,tx);
  if(m.contextVersion!==body.expectedContextVersion||a.previewHash!==body.previewHash)throw new AppError("OUTPUT_CHANGED","成果或上下文已变化，请重新预览",409);
  const old=await tx.missionArtifactReceipt.findUnique({where:{outputId_artifactType:{outputId,artifactType:body.artifactType}}});if(old){await event(tx,id,"OUTPUT_ADOPTION_REPLAY",{receiptId:old.id},{id:commandKey,hash});return old;}
  const artifact=await saveArtifactInTx(tx,m.projectId,body.artifactType,a.value.content);
  const receipt=await tx.missionArtifactReceipt.create({data:{projectId:m.projectId,missionId:id,outputId,outputRevision:a.value.outputRevision,outputHash:a.value.outputHash,artifactId:artifact.id,artifactType:body.artifactType,sourceManifestJson:json(a.value.sourceManifest),blockMapJson:json(a.value.blockMap),verificationSnapshotJson:json(a.value.verification),createdByUserId:userId,requestId:body.requestId,payloadHash:hash}});
  await event(tx,id,"OUTPUT_ADOPTED",{receiptId:receipt.id,artifactId:artifact.id,outputId,outputRevision:a.value.outputRevision});return receipt;
 };
 return transaction?apply(transaction):db.$transaction(apply);
}
