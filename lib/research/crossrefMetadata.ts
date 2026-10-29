import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/api";

export function normalizeDoi(raw:string){
 const doi=raw.trim().replace(/^doi:\s*/i,"").replace(/^https:\/\/(?:dx\.)?doi\.org\//i,"").toLowerCase();
 if(doi.length>200||!/^10\.\d{4,9}\/[^\s%?#\\]+$/.test(doi))throw new AppError("DOI_INVALID","请提供有效的公开 DOI",422);
 return doi;
}
const text=z.string().max(20000);
const relationSchema=z.record(z.string(),z.array(z.object({id:text,"id-type":text.optional()}).passthrough()).max(30));
const workSchema=z.object({DOI:text,title:z.array(text).max(20).optional(),type:text.optional(),abstract:text.optional(),publisher:text.optional(),
 published:z.object({"date-parts":z.array(z.array(z.number().int()).min(1).max(3)).max(4)}).optional(),relation:relationSchema.optional(),
 "update-to":z.array(z.object({DOI:text,type:text.optional()}).passthrough()).max(30).optional(),
}).passthrough();
/** Metadata is publisher-deposited reference material, not full text, authorization or a project measurement. */
export function normalizeCrossrefWork(raw:unknown){
 const work=workSchema.parse(raw),doi=normalizeDoi(work.DOI),plain=(s:string)=>s.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
 const abstract=work.abstract?plain(work.abstract):null;
 const data={doi,title:plain(work.title?.[0]??"").slice(0,500),publisher:work.publisher?.slice(0,200)??null,workType:work.type??null,
  publishedDateParts:work.published?.["date-parts"]??null,abstract:abstract?.slice(0,1600)??null,abstractTruncated:(abstract?.length??0)>1600,
  relations:Object.entries(work.relation??{}).map(([kind,items])=>({kind,items:items.slice(0,10).map(r=>({id:r.id.slice(0,200),idType:r["id-type"]??null}))})).slice(0,12),
  updates:(work["update-to"]??[]).map(r=>({doi:r.DOI,type:r.type??null})),edition:null,fullTextRead:false,
  readLevel:"ACADEMIC_METADATA" as const,authority:"EXTERNAL_UNVERIFIED_NEVER_USER_AUTHORIZATION" as const,projectOutcome:"UNKNOWN" as const};
 return {...data,normalizedContentHash:createHash("sha256").update(JSON.stringify(data)).digest("hex"),provider:"Crossref",requestedUrl:"https://api.crossref.org/works/"+encodeURIComponent(doi)};
}
/** Caller must supply original Turn/Step dispatch, public-scope admission and cumulative HTTP reservation. No standalone network entry point. */
export async function readCrossrefMetadata(doi:string,dispatch:(url:string,run:()=>Promise<unknown>)=>Promise<unknown>,transport:typeof fetch=fetch,signal?:AbortSignal){
 doi=normalizeDoi(doi);const url="https://api.crossref.org/works/"+encodeURIComponent(doi);
 const body=await dispatch(url,async()=>{
  const response=await transport(url,{method:"GET",redirect:"error",signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]),headers:{Accept:"application/json","User-Agent":"ProjectMemo/CT6-metadata"}});
  if(!response.ok)throw new AppError("ACADEMIC_SOURCE_UNAVAILABLE","论文元数据暂不可读，请保留原请求状态",502);
  const reader=response.body?.getReader();if(!reader)throw new AppError("ACADEMIC_EMPTY_RESPONSE","没有取得元数据正文",502);
  const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>131072)throw new AppError("ACADEMIC_RESPONSE_LIMIT","元数据超出读取上限",422);chunks.push(next.value);}}
  finally{await reader.cancel().catch(()=>undefined);}
  const parsed=z.object({message:workSchema}).parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  return {message:workSchema.strip().parse(parsed.message),projectMemoObservedAt:new Date().toISOString()};
 });
 const envelope=z.object({message:z.unknown(),projectMemoObservedAt:z.string().datetime().optional()}).parse(body),result=normalizeCrossrefWork(envelope.message);
 if(result.doi!==doi)throw new AppError("ACADEMIC_IDENTITY_CHANGED","元数据返回 DOI 与原请求不一致",409);
 return {...result,observedAt:envelope.projectMemoObservedAt??new Date().toISOString()};
}
