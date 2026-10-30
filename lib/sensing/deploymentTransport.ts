import {lookup} from "node:dns/promises";
import {BlockList,isIP} from "node:net";
import https from "node:https";
import {AppError} from "@/lib/api";
import {publicUrl} from "@/lib/research/queryPolicy";

const blocked4=new BlockList();
for(const [ip,bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]] as const)blocked4.addSubnet(ip,bits,"ipv4");
const global6=new BlockList();global6.addSubnet("2000::",3,"ipv6");
const blocked6=new BlockList();for(const [ip,bits] of [["2001::",23],["2001:db8::",32],["2002::",16],["3fff::",20]] as const)blocked6.addSubnet(ip,bits,"ipv6");
export function publicDeploymentAddress(address:string){
  const family=isIP(address);
  return family===4?!blocked4.check(address,"ipv4"):family===6&&global6.check(address,"ipv6")&&!blocked6.check(address,"ipv6");
}
export type DeploymentHttpResult={status:number;contentType:string;body:unknown;observedAt:string};
export type DeploymentTransport=(url:string,signal:AbortSignal)=>Promise<DeploymentHttpResult>;
/** GET only, one DNS resolution pinned into the socket, normal hostname/TLS verification, no redirects/cookies/proxy credentials. */
export const deploymentTransport:DeploymentTransport=async(raw,signal)=>{
  signal=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
  const url=new URL(publicUrl(raw));
  if(url.search)throw new AppError("DEPLOYMENT_URL_DENIED","观察路径不能携带查询参数",422);
  signal.throwIfAborted();
  let abort!:()=>void;
  const aborted=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener("abort",abort,{once:true});if(signal.aborted)abort();});
  const addresses=await Promise.race([lookup(url.hostname,{all:true,verbatim:true}),aborted]).finally(()=>signal.removeEventListener("abort",abort));signal.throwIfAborted();
  if(!addresses.length||addresses.some(a=>!publicDeploymentAddress(a.address)))throw new AppError("DEPLOYMENT_ADDRESS_DENIED","观察地址解析到非公开网络，未发出HTTP请求",422);
  const target=addresses[0];
  return new Promise((resolve,reject)=>{
    const options:https.RequestOptions&{autoSelectFamily:boolean}={method:"GET",agent:false,signal,family:target.family,autoSelectFamily:false,lookup:(_host,_options,cb)=>cb(null,target.address,target.family),
      headers:{Accept:"application/json","User-Agent":"ProjectMemo-Deployment-Observer"}};
    const request=https.request(url,options,response=>{
      const status=response.statusCode??0,contentType=String(response.headers["content-type"]??"").split(";")[0].toLowerCase();
      if(status!==200||!/^application\/(?:[a-z0-9.-]+\+)?json$/.test(contentType)){
        response.destroy();resolve({status,contentType,body:null,observedAt:new Date().toISOString()});return;
      }
      const chunks:Buffer[]=[];let bytes=0;
      response.on("data",(chunk:Buffer)=>{bytes+=chunk.byteLength;if(bytes>32768)response.destroy(new AppError("DEPLOYMENT_RESPONSE_LIMIT","观察正文超过32KB读取上限",502));else chunks.push(chunk);});
      response.once("error",reject);
      response.once("end",()=>{try{resolve({status,contentType,body:JSON.parse(Buffer.concat(chunks).toString("utf8")),observedAt:new Date().toISOString()});}catch{reject(new AppError("DEPLOYMENT_RESPONSE_INVALID","观察未返回有效JSON，不能作为服务通过证据",502));}});
    });
    request.once("error",reject);request.end();
  });
};
