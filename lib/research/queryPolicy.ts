import {isIP} from "node:net";
import {AppError} from "@/lib/api";
import {researchScopeSchema} from "@/lib/types/mission";
export function publicUrl(raw:string,allowedHosts:string[]=[]){
 let u:URL;try{u=new URL(raw);}catch{throw new AppError("UNSAFE_URL","资料链接格式无效",422);}
 const h=u.hostname.toLowerCase().replace(/\.$/,"");
 if(u.protocol!=="https:"||u.username||u.password||(u.port&&u.port!=="443")||isIP(h.replace(/^\[|\]$/g,""))||!h.includes(".")||/(^|\.)(localhost|local|internal|test|invalid)$/.test(h)||h.endsWith(".local")||h.endsWith(".internal")||u.hash||raw.length>8192)throw new AppError("UNSAFE_URL","只能读取公开 HTTPS 资料链接",422);
 if(allowedHosts.length&&!allowedHosts.some(a=>h===a.toLowerCase()))throw new AppError("URL_OUT_OF_SCOPE","资料域名超出授权范围",409);
 return u.href;
}
export function checkPublicQuery(query:string,rawScope:unknown){
 const scope=researchScopeSchema.parse(rawScope);const q=query.normalize("NFKC").trim();
 if(!scope.enabled||!scope.allowedCategories.includes("PUBLIC_TOPIC"))throw new AppError("RESEARCH_NOT_ALLOWED","该委托未授权公开研究",409);
 if(!q||[...q].length>128||/[\r\n\x00-\x1f]|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b(?:sk-|bearer\s|api[_ -]?key|password|token\s*[:=])|(?:内部实验|未公开|身份证|手机号|密钥)/i.test(q)||/%[a-f0-9]{2}|\\u[0-9a-f]{4}/i.test(q))throw new AppError("QUERY_SENSITIVE","搜索查询包含敏感信息或不支持的编码",409);
 if(scope.excludedTerms.some(t=>q.toLowerCase().includes(t.toLowerCase())))throw new AppError("QUERY_OUT_OF_SCOPE","查询涉及用户排除的内容",409);
 if(!scope.publicTerms.some(t=>q.toLowerCase().includes(t.toLowerCase())))throw new AppError("QUERY_OUT_OF_SCOPE","查询未关联批准的公开概念，请调整研究范围",409);
 const sites=[...q.matchAll(/(?:^|\s)-?site:([^\s]+)/gi)].map(m=>m[1]);
 if(sites.some(site=>scope.allowedHosts.length&&!scope.allowedHosts.includes(site)))throw new AppError("QUERY_OUT_OF_SCOPE","查询站点超出授权范围",409);
 return q;
}
