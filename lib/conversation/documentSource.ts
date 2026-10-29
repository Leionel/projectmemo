import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { ownedConversation,record } from "./repository";
import { assertSourceUse } from "@/lib/continuity/sourcePolicy";
import { validateDocumentObservation } from "@/lib/documents/observations";
import type { ConversationActor,ConversationSource } from "@/lib/types/conversation";
export async function readConversationDocumentSource(actor:ConversationActor,id:string,turnId:string,sourceId:string){
 await ownedConversation(actor,id);const turn=await db.conversationTurn.findFirst({where:{id:turnId,conversationId:id}});
 const sources=record(turn?.readManifestJson).documentSources;
 const source=Array.isArray(sources)?(sources as ConversationSource[]).find(s=>s.sourceId===sourceId):null;
 if(!source?.document)throw new AppError("SOURCE_NOT_FOUND","该讨论中没有这份文档观察",404);
 await assertSourceUse(actor.userId,source.projectId,sourceId,db,{conversationId:id});await validateDocumentObservation(actor.userId,source.projectId,sourceId,source.revision);return source;
}
