import http from "node:http";
import https from "node:https";
import {createBrotliDecompress, createUnzip} from "node:zlib";
import {AppError} from "@/lib/api";

/** Chromium receives only fulfilled responses; DNS, TLS and streamed body limits stay in this transport. */
export async function readBrowserResource(url: string, addresses: string[], signal: AbortSignal, consume: (bytes: number) => void) {
  signal.throwIfAborted();
  const target=addresses[0];
  if(!target)throw new AppError("BROWSER_DNS_FAILED","网页地址没有可用解析结果",422);
  const {isIP}=await import("node:net");
  return new Promise<{status:number;headers:Record<string,string>;body:Buffer}>((resolve,reject)=>{
    const parsed=new URL(url),transport=parsed.protocol==="https:"?https:http;
    const request=transport.request(parsed,{method:"GET",agent:false,signal,autoSelectFamily:false,
      lookup:(_host,_options,callback)=>callback(null,target,isIP(target)),
      headers:{Accept:"*/*","Accept-Encoding":"identity","User-Agent":"ProjectMemo-Isolated-Reader"}} as https.RequestOptions & {autoSelectFamily:boolean},response=>{
      const headers:Record<string,string>={};
      for(const [key,value] of Object.entries(response.headers))if(typeof value==="string"&&!["set-cookie","transfer-encoding","content-length","content-encoding"].includes(key))headers[key]=value;
      if([301,302,303,307,308].includes(response.statusCode??0)){response.destroy();resolve({status:response.statusCode!,headers,body:Buffer.alloc(0)});return;}
      const encoding=String(response.headers["content-encoding"]??"identity").toLowerCase();
      if(!["identity","gzip","deflate","br"].includes(encoding)){response.destroy();reject(new AppError("BROWSER_ENCODING_DENIED","网页响应编码不可核对",422));return;}
      const stream=encoding==="identity"?response:response.pipe(encoding==="br"?createBrotliDecompress():createUnzip());
      const chunks:Buffer[]=[];
      const fail=(error:Error)=>{response.destroy();stream.destroy();request.destroy();reject(error);};
      response.on("error",fail);stream.on("error",fail);
      stream.on("data",(chunk:Buffer)=>{try{consume(chunk.byteLength);chunks.push(chunk);}catch(error){fail(error as Error);}});
      stream.once("end",()=>resolve({status:response.statusCode??502,headers,body:Buffer.concat(chunks)}));
    });
    request.once("error",reject);request.end();
  });
}
