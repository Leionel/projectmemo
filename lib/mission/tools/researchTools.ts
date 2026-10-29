import { reserveCloudCall } from "@/lib/auth/cloudQuota";
import {z} from "zod";
import {db} from "@/lib/db";
import {AppError} from "@/lib/api";
import {isFeatureEnabled} from "@/lib/config/features";
import {jsonHash,json,type Source} from "../contracts";
import {event} from "../repository";
import {fenced,reserve,settleUsage,type Lease} from "../runtimeStore";
import {chooseNext,type DecisionProvider} from "../modelAdapter";
import {ModelProtocolError} from "../modelProtocol";
import type {ToolSet} from "../tools";
import {researchScopeSchema} from "@/lib/types/mission";
import {deepSeekResearch} from "@/lib/research/searchProvider";
import {checkPublicQuery,publicUrl} from "@/lib/research/queryPolicy";
import {observation} from "@/lib/research/sourceRepository";
import type {ResearchProvider} from "@/lib/research/contracts";
export type ResearchDependencies={provider?:ResearchProvider;queryProvider?:DecisionProvider};
const effects={businessWrite:false,cacheWrite:false,externalDisclosure:true};
const queryTool:ToolSet={submit_public_query:{description:"为已授权公开主题形成一个研究查询，可自主选公开方法、论文、评测词；不能扩展主题或请求私有数据。",schema:z.object({query:z.string().min(1).max(128)}).strict(),effects:{...effects,externalDisclosure:false},run:async()=>({data:null,sources:[]})}};
async function researchMission(lease:Lease){
 if(!isFeatureEnabled("MISSION_WEB_ENABLED",false))throw new AppError("WEB_DISABLED","当前公开研究功能已关闭",503);
 return db.$transaction(async tx=>{const m=await fenced(tx,lease);const scope=researchScopeSchema.parse(m.researchScopeJson);if(!scope.enabled)throw new AppError("RESEARCH_NOT_ALLOWED","请先确认公开研究范围",409);return{m,scope};});
}
export function researchTools(lease:Lease,deps:ResearchDependencies={}):ToolSet{
 const provider=deps.provider??deepSeekResearch;
 return {
 web_search:{description:"在用户批准的公开研究范围内自主检索。选择研究方向，不传项目正文或自拟完整查询；系统使用隔离公开上下文生成查询。",schema:z.object({focus:z.enum(["METHODS","PAPERS","EVALUATION","COMPARISON"]),scopeRevision:z.number().int().positive()}).strict(),effects,run:async(actor,raw)=>{
  const input=raw as {focus:string;scopeRevision:number};const {m,scope}=await researchMission(lease);
  if(input.scopeRevision!==m.researchScopeVersion)throw new AppError("SCOPE_CHANGED","公开研究授权已变化",409);
  const publicSources=scope.allowedCategories.includes("PUBLIC_SOURCE")?await db.externalSource.findMany({where:{missionId:actor.missionId},take:8,orderBy:{fetchedAt:"desc"},select:{title:true,excerptJson:true}}):[];
  // This decision receives no goal, private messages, project cards, constraints or internal measurements.
  if(!deps.queryProvider)await reserveCloudCall(m.projectId);
  await reserve(lease,"models");const start=Date.now();const decision=await (async()=>{try{return await (deps.queryProvider??chooseNext)(JSON.stringify({goal:"仅为以下已批准公开主题形成检索查询；从公开资料自主选择关键词，保留至少一个公开概念。必须调用 submit_public_query 工具。",scope,focus:input.focus,publicSources:publicSources.map(s=>({title:s.title,text:(s.excerptJson as {text?:string}).text?.slice(0,800)}))}),queryTool);}catch(error){if(error instanceof ModelProtocolError)await settleUsage(lease,"models",Date.now()-start,error.metadata.usage);throw error;}})();
  await settleUsage(lease,"models",Date.now()-start,decision.usage);
  if(decision.choice.kind!=="tool"||decision.choice.tool!=="submit_public_query")throw new AppError("QUERY_NOT_GENERATED","未生成有效的公开研究查询",409);
  const suggested=(queryTool.submit_public_query.schema.parse(decision.choice.args) as {query:string}).query;
  let query:string;try{query=checkPublicQuery(suggested,scope);}catch(error){await db.$transaction(async tx=>{await fenced(tx,lease);await event(tx,m.id,"QUERY_REJECTED",{queryHash:jsonHash(suggested),scopeRevision:m.researchScopeVersion,reason:error instanceof AppError?error.code:"QUERY_INVALID"});});throw error;}
  await db.$transaction(async tx=>{await fenced(tx,lease);await event(tx,m.id,"QUERY_SENT",{query,scopeRevision:m.researchScopeVersion,categories:scope.allowedCategories,provider:provider.name});await tx.agentRun.create({data:{projectId:m.projectId,runType:"CHAT",status:"SUCCESS",provider:decision.provider,trace:json({missionId:m.id,purpose:"PUBLIC_QUERY",model:decision.model,usage:decision.usage}),resultJson:{queryHash:jsonHash(query)}}});});
  if(!deps.provider)await reserveCloudCall(m.projectId);
  const hits=await provider.search(query);const observations=[];
  for(const hit of hits.slice(0,5)){let url:string;try{url=publicUrl(hit.url,scope.allowedHosts);}catch{continue;}observations.push(observation(m.id,url,"SEARCH_SNIPPET",hit.title,hit.snippet.slice(0,1200),hit.date,m.researchScopeVersion));}
  return{data:{query,results:observations.map(s=>({sourceId:s.id,revision:s.normalizedContentHash,url:s.requestedUrl,title:s.title,snippet:s.excerpt.text,publishedAt:s.publishedAt})),observations},sources:[]};
 }},
 web_fetch:{description:"读取本委托已检索的公开来源正文。参数只能是来源ID，不接受任意URL。返回托管提取文本，最终域名未独立验证。",schema:z.object({sourceId:z.string().min(1),scopeRevision:z.number().int().positive()}).strict(),effects,run:async(actor,raw)=>{
  const input=raw as {sourceId:string;scopeRevision:number};const {m,scope}=await researchMission(lease);if(input.scopeRevision!==m.researchScopeVersion)throw new AppError("SCOPE_CHANGED","研究范围已变化",409);
  const found=await db.externalSource.findFirst({where:{id:input.sourceId,missionId:m.id}});if(!found)throw new AppError("SOURCE_NOT_FOUND","资料不属于当前委托",404);
  const url=publicUrl(found.requestedUrl,scope.allowedHosts);if(!deps.provider)await reserveCloudCall(m.projectId);const page=await provider.fetchPage(url);if(!page.content.trim())throw new AppError("EMPTY_SOURCE","该网页没有可读取正文，请换一个来源",422);
  const record=observation(m.id,url,"PROVIDER_EXTRACT",page.title,page.content,found.publishedAt?.toISOString(),m.researchScopeVersion);
  const source:Source={id:record.id,kind:"EXTERNAL",entityType:"EXTERNAL_SOURCE",revision:record.normalizedContentHash,hash:record.normalizedContentHash,identityKey:url,text:record.excerpt.text,observedAt:new Date().toISOString()};
  return{data:{sourceId:record.id,title:record.title,url,content:record.excerpt.text,retrievalMode:"PROVIDER_EXTRACT",resolvedUrl:null,truncated:record.excerpt.truncated,observations:[record]},sources:[source]};
 }},
 };
}
