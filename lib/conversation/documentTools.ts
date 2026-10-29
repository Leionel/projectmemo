import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/api";
import { jsonHash } from "@/lib/mission/contracts";
import { readDocument } from "@/lib/documents/reader";
import type { DocumentCall } from "@/lib/types/document";
import type { ConversationActor,ConversationSource } from "@/lib/types/conversation";
import type { MaterialPointer } from "./toolAdapter";
import { mutateTurn } from "./turnRuntime";
import { record } from "./repository";
import { validateDocumentObservation } from "@/lib/documents/observations";
export async function readConversationDocumentTool(actor:ConversationActor,id:string,turnId:string,call:DocumentCall,pointers:MaterialPointer[]):Promise<{data:unknown;sources:ConversationSource[];coverage:Record<string,unknown>;discovered:MaterialPointer[]}>{
 if(!pointers.some(p=>p.projectId===call.projectId&&p.sourceId===call.sourceId&&p.revision===call.revision))throw new AppError("SOURCE_NOT_OBSERVED","请先定位当前项目中的原附件",409);
 const result=await readDocument({...actor,conversationId:id,missionId:actor.missionProjectId===call.projectId?actor.missionId:undefined},call),text=result.text.slice(0,5000),document={...result.document,...(result.document.span?{span:{...result.document.span,end:result.document.span.start+text.length}}:{}),conversationId:id,turnId},revision=jsonHash({document,text}),sourceId="doc:"+randomUUID();
 const source:ConversationSource={id:call.projectId+"/"+sourceId,sourceId,projectId:call.projectId,revision,document,title:result.title,excerpt:text,start:0,end:text.length,excerptHash:jsonHash(text),observedAt:document.observedAt,temporalState:"UNKNOWN",knowledgeClass:"MIXED",readScope:"EXCERPT"};
 await mutateTurn(actor,id,turnId,manifest=>({...manifest,documentSources:[...record(manifest).documentSources as ConversationSource[]??[],source].slice(-24)}));
 await validateDocumentObservation(actor.userId,call.projectId,sourceId,revision);
 return {data:result.data,sources:[source],coverage:{...result.coverage,sourceExcerptTruncated:text.length<result.text.length},discovered:[{projectId:call.projectId,sourceId:call.sourceId,revision:call.revision,title:document.fileName,documentCatalog:result.catalog}]};
}
