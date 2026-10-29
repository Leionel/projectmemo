import {AppError} from "@/lib/api";
import {fetchResponseSchema,searchResponseSchema,type ResearchProvider} from "./contracts";
export async function readLimitedJson(response:Response,maxBytes=524288):Promise<unknown>{
 if(!response.body)throw new AppError("EMPTY_RESEARCH_RESPONSE","资料服务没有返回正文",503);
 const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw new AppError("RESEARCH_RESPONSE_LIMIT","资料正文超过读取上限",422);parts.push(chunk.value);}return JSON.parse(Buffer.concat(parts).toString("utf8"));}finally{await reader.cancel().catch(()=>undefined);}
}
async function request(endpoint:"search"|"fetch",body:unknown,signal?:AbortSignal){
 const key=process.env.MISSION_SEARCH_API_KEY??process.env.LLM_API_KEY;
 if(!key)throw new AppError("SEARCH_NOT_CONFIGURED","尚未配置搜索服务凭据",503);
 // Endpoint is fixed; target-page content never selects a server endpoint or receives this key.
 const response=await fetch(`https://api.deepseek.com/v1/tools/${endpoint}`,{method:"POST",redirect:"error",signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify(body)});
 if(!response.ok){
  const retryable=response.status===408||response.status===429||response.status>=500;
  const code=response.status===401?"SEARCH_AUTH_ERROR":response.status===402?"SEARCH_BALANCE_EMPTY":response.status===403?"SOURCE_BLOCKED":response.status===404?"SOURCE_UNAVAILABLE":retryable?"RESEARCH_RETRYABLE":"RESEARCH_HTTP_ERROR";
  const message=response.status===401?"搜索服务凭据无效，请检查服务配置":response.status===402?"搜索服务余额不足，本轮未继续联网":response.status===403||response.status===404?"该网页未能取得可读内容，可换用公开来源或原文件":`资料服务返回 ${response.status}`;
  throw new AppError(code,message,retryable||response.status===401||response.status===402?503:422,{providerStatus:response.status,retryAfterMs:Math.min(30000,Math.max(0,Number(response.headers.get("retry-after")??0)*1000||Date.parse(response.headers.get("retry-after")??"")-Date.now()||0))});
 }
 if(!response.headers.get("content-type")?.includes("application/json"))throw new AppError("RESEARCH_CONTENT_TYPE","资料服务返回了不支持的类型",422);
 return readLimitedJson(response);
}
export const deepSeekResearch:ResearchProvider={name:"deepseek",search:async(query,options)=>searchResponseSchema.parse(await request("search",{query,count:options?.count??5,need_content:options?.needContent??false},options?.signal)).results,fetchPage:async(url,options)=>fetchResponseSchema.parse(await request("fetch",{url},options?.signal))};
