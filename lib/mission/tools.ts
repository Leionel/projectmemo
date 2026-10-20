import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { getTemporalSearchStates } from "@/lib/services/temporalLedgerService";
import { searchProjectCards } from "@/lib/memory/hybridSearch";
import { jsonHash, type Actor, type ToolResult, type Source } from "./contracts";
import { sourceHash } from "./repository";
export type Tool = { description:string; schema:z.ZodType; effects:{businessWrite:boolean;cacheWrite:boolean;externalDisclosure:boolean}; run:(actor:Actor,input:unknown)=>Promise<ToolResult> };
export type ToolSet=Record<string,Tool>;
const readEffects={businessWrite:false,cacheWrite:false,externalDisclosure:false};
export const actionProposalSchema=z.object({title:z.string().trim().min(2).max(160),description:z.string().max(500).default(""),priority:z.number().int().min(1).max(5).default(3),dueAt:z.string().datetime().nullable().optional()}).strict();
export const outputSchema=z.object({schemaVersion:z.literal(1).default(1),kind:z.enum(["NOTE","RESEARCH"]).default("NOTE"),blocks:z.array(z.object({blockId:z.string().min(1).max(80),text:z.string().min(1).max(1500),kind:z.enum(["PROJECT_OBSERVATION","EXTERNAL_REFERENCE","INFERENCE"]),sourceIds:z.array(z.string().max(160)).max(8)}).strict()).min(1).max(12),missingInformation:z.array(z.string().max(300)).max(12).default([])}).strict();
export const projectTools:ToolSet={
 inspect_project:{description:"读取当前项目目标与真实行动。来源是项目观察，不证明实验结论。",schema:z.object({}).strict(),effects:readEffects,run:async actor=>{
   const before=await sourceHash(actor.projectId,`project:${actor.projectId}`);
   const project=await db.project.findUniqueOrThrow({where:{id:actor.projectId},select:{title:true,goal:true,deadline:true}});
   const actions=await db.actionItem.findMany({where:{projectId:actor.projectId,isSimulated:false},take:20,orderBy:{id:"asc"},select:{id:true,title:true,status:true,priority:true,dependencyVersion:true,dueAt:true}});
   const hash=await sourceHash(actor.projectId,`project:${actor.projectId}`);if(before!==hash)throw new AppError("SOURCE_CHANGED","项目刚发生变化，请重新读取",409);
   const data={project,actions,truncated:await db.actionItem.count({where:{projectId:actor.projectId,isSimulated:false}})>20};
   return{data,sources:[{id:`project:${actor.projectId}`,kind:"PROJECT",entityType:"PROJECT",revision:hash!,hash:hash!,text:JSON.stringify(data).slice(0,4000),observedAt:new Date().toISOString()}]};
 }},
 search_memory:{description:"检索本项目记忆，保留当前/历史/争议/未知状态；不补远程嵌入。",schema:z.object({query:z.string().min(1).max(256),limit:z.number().int().min(1).max(8).default(8)}).strict(),effects:readEffects,run:async(actor,raw)=>{
   if(await db.knowledgeCard.count({where:{projectId:actor.projectId}})>300)throw new AppError("CONTEXT_TOO_LARGE","项目资料超出首版检索范围",409);
   const results=await searchProjectCards({projectId:actor.projectId,...raw as {query:string;limit:number},semantic:false});
   const states=await getTemporalSearchStates(actor.projectId,results.map(c=>c.cardId));
   const sources:Source[]=[];
   for(const c of results){const card=await db.knowledgeCard.findFirst({where:{id:c.cardId,projectId:actor.projectId}});if(!card||card.title!==c.title||card.summary!==c.summary)throw new AppError("SOURCE_CHANGED","记忆刚发生变化，请重新检索",409);const hash=await sourceHash(actor.projectId,`card:${c.cardId}`);sources.push({id:`card:${c.cardId}`,kind:"PROJECT",entityType:"CARD",revision:hash!,hash:hash!,text:`${c.title}\n${c.summary}`,observedAt:new Date().toISOString()});}
   return{data:results.map(c=>({...c,temporal:states.get(c.cardId)?.topLevelState??"UNKNOWN"})),sources};
 }},
 save_mission_output:{description:"保存委托私有 Output 新版本。观察须引用来源，推断标明；不发布项目事实。",schema:outputSchema,effects:readEffects,run:async(_actor,input)=>({data:input,sources:[]})},
 propose_action:{description:"提出待办并等待用户批准，不创建行动。",schema:actionProposalSchema,effects:readEffects,run:async(_actor,input)=>({data:input,sources:[]})},
 inspect_action:{description:"读回本项目真实行动；TODO 不代表现实完成。",schema:z.object({actionId:z.string().min(1)}).strict(),effects:readEffects,run:async(actor,raw)=>{const action=await db.actionItem.findFirst({where:{id:(raw as {actionId:string}).actionId,projectId:actor.projectId,isSimulated:false}});if(!action)throw new AppError("ACTION_NOT_FOUND","没有找到可访问的行动",404);return{data:action,sources:[]};}},
};
export function sourcesFrom(results:unknown[]):Source[]{const all=results.flatMap(v=>Array.isArray((v as ToolResult|null)?.sources)?(v as ToolResult).sources:[]);return [...new Map(all.map(s=>[s.id,s])).values()];}
export function toolInputHash(tool:string,args:unknown,sources:Source[]){return jsonHash({tool,args,sources:sources.map(s=>({id:s.id,hash:s.hash}))});}
