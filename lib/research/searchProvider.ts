import {AppError} from "@/lib/api";
import {fetchResponseSchema,searchResponseSchema,type ResearchProvider} from "./contracts";
export async function readLimitedJson(response:Response,maxBytes=524288):Promise<unknown>{
 if(!response.body)throw new AppError("EMPTY_RESEARCH_RESPONSE","资料服务没有返回正文",503);
 const reader=response.body.getReader();let size=0;const parts:Uint8Array[]=[];
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>maxBytes)throw new AppError("RESEARCH_RESPONSE_LIMIT","资料正文超过读取上限",422);parts.push(chunk.value);}return JSON.parse(Buffer.concat(parts).toString("utf8"));}finally{await reader.cancel().catch(()=>undefined);}
}
async function request(endpoint:"search"|"fetch",body:unknown){
 const key=process.env.MISSION_SEARCH_API_KEY??process.env.LLM_API_KEY;
 if(!key)throw new AppError("SEARCH_NOT_CONFIGURED","尚未配置搜索服务凭据",503);
 // Endpoint is fixed; target-page content never selects a server endpoint or receives this key.
 const response=await fetch(`https://api.deepseek.com/v1/tools/${endpoint}`,{method:"POST",redirect:"error",signal:AbortSignal.timeout(20000),headers:{"Content-Type":"application/json",Authorization:`Bearer ${key}`},body:JSON.stringify(body)});
 if(!response.ok)throw new AppError(response.status===429||response.status>=500?"RESEARCH_RETRYABLE":"RESEARCH_HTTP_ERROR",`资料服务返回 ${response.status}`,response.status===429||response.status>=500?503:422,{retryAfterMs:Math.min(30000,Math.max(0,Number(response.headers.get("retry-after")??0)*1000||Date.parse(response.headers.get("retry-after")??"")-Date.now()||0))});
 if(!response.headers.get("content-type")?.includes("application/json"))throw new AppError("RESEARCH_CONTENT_TYPE","资料服务返回了不支持的类型",422);
 return readLimitedJson(response);
}
export const deepSeekResearch:ResearchProvider={name:"deepseek",search:async query=>searchResponseSchema.parse(await request("search",{query,count:5,need_content:false})).results,fetchPage:async url=>fetchResponseSchema.parse(await request("fetch",{url}))};
