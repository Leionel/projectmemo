import { memoryQuerySchema, searchMissionMemory } from "./memorySearch";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { jsonHash, type Actor, type ToolResult, type Source } from "./contracts";
import { sourceHash } from "./repository";
import { readReviewMaterial } from "./projectMaterialReader";
export type Tool = { version?:string; description:string; schema:z.ZodType; effects:{businessWrite:boolean;cacheWrite:boolean;externalDisclosure:boolean}; run:(actor:Actor,input:unknown)=>Promise<ToolResult> };
export type ToolSet=Record<string,Tool>;
const readEffects={businessWrite:false,cacheWrite:false,externalDisclosure:false};
export const actionProposalSchema=z.object({title:z.string().trim().min(2).max(160),description:z.string().max(500).default(""),priority:z.number().int().min(1).max(5).default(3),dueAt:z.string().datetime().nullable().optional()}).strict();
export const outputSchema=z.object({schemaVersion:z.literal(1).default(1),kind:z.enum(["NOTE","RESEARCH"]).default("NOTE"),blocks:z.array(z.object({blockId:z.string().min(1).max(80),text:z.string().min(1).max(1500),kind:z.enum(["PROJECT_OBSERVATION","EXTERNAL_REFERENCE","INFERENCE"]),sourceIds:z.array(z.string().max(160)).max(8),citations:z.array(z.object({sourceId:z.string(),start:z.number().int().nonnegative(),end:z.number().int().positive(),excerptHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).max(8).default([])}).strict()).min(1).max(12),missingInformation:z.array(z.string().max(300)).max(12).default([])}).strict();
export const projectTools:ToolSet={
 read_project_material:{version:"1",description:"定向读取已确认的本项目记录或附件片段；只接受原来源ID与版本，不接路径或URL。",schema:z.object({sourceId:z.string().min(1).max(160),sourceHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),effects:readEffects,run:async(actor,raw)=>{
   const input=raw as {sourceId:string;sourceHash:string};const material=await readReviewMaterial(actor.projectId,input.sourceId);
   if(!material||material.source.hash!==input.sourceHash)throw new AppError("SOURCE_CHANGED","指定资料已变化或不可访问",409);
   if(!material.source.text.trim())throw new AppError("SOURCE_NOT_READABLE","资料正文尚不可读",409);
   return{data:{title:material.title,readScope:material.readScope,content:material.source.text,coverage:material.coverage},sources:[material.source],coverage:material.coverage};
 }},
 inspect_project:{description:"读取当前项目目标与真实行动。来源是项目观察，不证明实验结论。",schema:z.object({afterId:z.string().min(1).max(160).optional()}).strict(),effects:readEffects,run:async (actor,raw)=>{
   const before=await sourceHash(actor.projectId,`project:${actor.projectId}`);
   const project=await db.project.findUniqueOrThrow({where:{id:actor.projectId},select:{title:true,goal:true,deadline:true}});
   const actions=await db.actionItem.findMany({where:{projectId:actor.projectId,isSimulated:false,...((raw as {afterId?:string}).afterId?{id:{gt:(raw as {afterId:string}).afterId}}:{})},take:21,orderBy:{id:"asc"},select:{id:true,title:true,status:true,priority:true,dependencyVersion:true,dueAt:true}});
   const hash=await sourceHash(actor.projectId,`project:${actor.projectId}`);if(before!==hash)throw new AppError("SOURCE_CHANGED","项目刚发生变化，请重新读取",409);
   const total=await db.actionItem.count({where:{projectId:actor.projectId,isSimulated:false}});
   const coverage={totalActions:total,returnedActions:Math.min(20,actions.length),nextCursor:actions.length>20?actions[19].id:null,complete:!(raw as {afterId?:string}).afterId&&actions.length<=20};
   const data={project,actions:actions.slice(0,20),coverage,truncated:!coverage.complete};
   return{data,coverage,sources:[{id:`project:${actor.projectId}`,kind:"PROJECT",entityType:"PROJECT",revision:hash!,hash:hash!,text:JSON.stringify(data),observedAt:new Date().toISOString()}]};
 }},
 search_memory:{description:"按主题分页检索本项目标题与摘要。coverage说明范围；用afterId继续，用sourceIds定向读已知旧/归档卡片；无结果不等于不存在。",schema:memoryQuerySchema,effects:readEffects,run:searchMissionMemory},
 save_mission_output:{description:"保存委托私有 Output 新版本。观察须引用来源，推断标明；不发布项目事实。",schema:outputSchema,effects:readEffects,run:async(_actor,input)=>({data:input,sources:[]})},
 propose_action:{description:"提出待办并等待用户批准，不创建行动。",schema:actionProposalSchema,effects:readEffects,run:async(_actor,input)=>({data:input,sources:[]})},
 inspect_action:{description:"读回本项目真实行动；TODO 不代表现实完成。",schema:z.object({actionId:z.string().min(1)}).strict(),effects:readEffects,run:async(actor,raw)=>{const action=await db.actionItem.findFirst({where:{id:(raw as {actionId:string}).actionId,projectId:actor.projectId,isSimulated:false}});if(!action)throw new AppError("ACTION_NOT_FOUND","没有找到可访问的行动",404);const hash=await sourceHash(actor.projectId,`action:${action.id}`);if(hash!==jsonHash(action))throw new AppError("SOURCE_CHANGED","行动刚发生变化，请重新读取",409);return{data:{...action,actionId:action.id},sources:[{id:`action:${action.id}`,kind:"PROJECT",entityType:"ACTION",revision:hash!,hash:hash!,text:JSON.stringify(action),observedAt:new Date().toISOString()}]};}},
};
export function sourcesFrom(results:unknown[]):Source[]{const all=results.flatMap(v=>Array.isArray((v as ToolResult|null)?.sources)?(v as ToolResult).sources:[]);return [...new Map(all.map(s=>[s.kind==="EXTERNAL"?s.identityKey??s.id:s.id,s])).values()];}
export function toolInputHash(tool:string,args:unknown,sources:Source[]){return jsonHash({tool,args,sources:sources.map(s=>({id:s.id,hash:s.hash}))});}
