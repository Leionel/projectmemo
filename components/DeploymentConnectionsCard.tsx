"use client";
import {useRouter} from "next/navigation";
import {useCallback,useEffect,useRef,useState} from "react";
import {bindConversationDraftOwner,clearConversationDraft,emptyConversationDraft,readConversationDraft,saveConversationDraft} from "@/lib/client/conversationDrafts";
import type {DeploymentConfig,DeploymentLayer} from "@/lib/types/deployment";

type Connection={id:string;revision:number;status:string;config:DeploymentConfig;latest:{sourceId:string;observedAt:string;validUntil:string;availability:string;layers:DeploymentLayer[]}|null};
type Reply={enabled:boolean;connections:Connection[]};
type Pending={path:string;method:"POST"|"PATCH";body:Record<string,unknown>};
const button="editorial-button-secondary focus-ring min-h-11 disabled:opacity-50 disabled:cursor-not-allowed";
const input="editorial-input mt-1 min-h-11 w-full px-3 py-2";
const layerLabels={BUILD:"构建",DEPLOY:"部署",SERVICE:"服务自检",USER_PATH:"公共用户路径"};
const stateLabels={OBSERVED:"已观察",FAILED:"未通过",UNKNOWN:"未知",PARTIAL:"部分证据",STALE:"已过期"};
const localInput=(value:string)=>{const d=new Date(value);return new Date(+d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
export function DeploymentConnectionsCard({projectId,ownerId}:{projectId:string;ownerId:string}){
  const [data,setData]=useState<Reply|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false),[pending,setPending]=useState<Pending|null>(null);
  const [environment,setEnvironment]=useState(""),[origin,setOrigin]=useState(""),[release,setRelease]=useState(""),[until,setUntil]=useState(""),[health,setHealth]=useState("/health"),[userPath,setUserPath]=useState(""),[logPath,setLogPath]=useState("");
  const [editSnapshot,setEditSnapshot]=useState<Connection|null>(null),[clock,setClock]=useState(()=>Date.now());
  const router=useRouter();
  const alive=useRef(true),readActive=useRef(false),readSequence=useRef(0),key="deployment-controls:"+projectId;
  const load=useCallback(async(force=false)=>{
    if(readActive.current&&!force)return;const sequence=++readSequence.current;readActive.current=true;
    try{const r=await fetch(`/api/projects/${projectId}/deployment-connections`,{signal:AbortSignal.timeout(15000)}),v=await r.json();if(!r.ok)throw Object.assign(new Error(v.error?.message??"环境许可暂不可读"),{status:r.status});if(alive.current&&sequence===readSequence.current){setData(v);setClock(Date.now());setError("");}}
    catch(e){if(alive.current&&sequence===readSequence.current){if([401,403,404].includes((e as {status:number}).status))setData(null);setError((e as Error).message);}}
    finally{if(sequence===readSequence.current)readActive.current=false;}
  },[projectId]);
  useEffect(()=>{
    alive.current=true;bindConversationDraftOwner(ownerId);
    queueMicrotask(()=>{if(!alive.current)return;const saved=readConversationDraft(key);if(saved.directiveRequest){try{setPending(JSON.parse(saved.directiveRequest));}catch{setError("上次请求暂不可读，请核对原授权记录");}}});
    queueMicrotask(()=>{if(alive.current)void load();});const focus=()=>void load();window.addEventListener("focus",focus);
    return()=>{alive.current=false;window.removeEventListener("focus",focus);};
  },[key,ownerId,load]);
  useEffect(()=>{
    const boundaries=(data?.connections??[]).flatMap(c=>[Date.parse(c.config.expiresAt),Date.parse(c.latest?.validUntil??"")]).filter(t=>t>clock);
    const delay=Math.min(30000,...boundaries.map(t=>Math.max(1,t-clock+20)));
    const timer=setTimeout(()=>{setClock(Date.now());void load();},delay);return()=>clearTimeout(timer);
  },[data,clock,load]);
  async function submit(request:Pending){
    if(busy)return;
    setBusy(true);setError("");
    const draft=emptyConversationDraft();draft.directiveRequest=JSON.stringify(request);saveConversationDraft(key,draft);
    if(readConversationDraft(key).directiveRequest!==draft.directiveRequest){setError("请求尚未保存，暂未提交");setBusy(false);return;}
    setPending(request);
    try{const r=await fetch(request.path,{method:request.method,headers:{"Content-Type":"application/json"},body:JSON.stringify(request.body),signal:AbortSignal.timeout(25000)}),v=await r.json();if(!r.ok)throw Object.assign(new Error(v.error?.message??"许可未保存"),{status:r.status});
      if(!alive.current)return;clearConversationDraft(key);setPending(null);setEditing(false);await load(true);
    }catch(e){if(!alive.current)return;const status=(e as {status?:number}).status;if(status&&status>=400&&status<500){clearConversationDraft(key);setPending(null);if(status===409)await load(true);}if(alive.current)setError((e as Error).message);}
    finally{if(alive.current)setBusy(false);}
  }
  function edit(c:Connection|null){setEditSnapshot(c);setEnvironment(c?.config.environment??"");setOrigin(c?.config.origin??"");setRelease(c?.config.expectedRelease??"");setHealth(c?.config.healthPath??"/health");setUserPath(c?.config.userPath??"");setLogPath(c?.config.logPath??"");setUntil(c?localInput(c.config.expiresAt):"");setEditing(true);setError("");}
  async function discuss(c:Connection){setBusy(true);try{const r=await fetch("/api/conversations/entry",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),scope:"PROJECT",projectId,entry:{kind:"SOURCE_OBSERVATION",projectId,id:c.id}}),signal:AbortSignal.timeout(25000)}),v=await r.json();if(!r.ok)throw new Error(v.error?.message??"讨论暂未打开");if(alive.current)router.push("/focus?conversation="+encodeURIComponent(v.id));}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}}
  if(!data)return error?<div className="card-surface p-4"><p role="alert">{error}</p><button className={button} onClick={()=>void load()}>重新读取环境许可</button></div>:null;
  if(!data.enabled&&!data.connections.length)return null;
  const disabled=busy||Boolean(pending);
  return <details className="card-surface p-4 sm:p-5"><summary className="focus-ring cursor-pointer py-2 font-semibold">工程验收与环境观察</summary><div className="grid gap-4 pt-4">
    {data.connections.map(c=>{const fresh=c.status==="ACTIVE"&&Date.parse(c.config.expiresAt)>clock&&c.latest?.availability==="CURRENT"&&Date.parse(c.latest.validUntil)>clock;
      return <article key={c.id} className="grid gap-3 border-b border-[var(--rule)] pb-5"><h3 className="break-all font-semibold">{c.config.environment} · {c.config.expectedRelease}</h3><p className="break-all text-sm">{c.config.origin} · {c.status==="ACTIVE"?Date.parse(c.config.expiresAt)>clock?"只读许可期内":"许可已到期":"已撤销"}</p>
        {c.latest?<><p className="text-sm">上次观察：{new Date(c.latest.observedAt).toLocaleString("zh-CN")} · {fresh?"证据在有效期内":c.latest.availability==="SUPPRESSED"?"已停止使用":"历史观察，需重新核对"}</p>{fresh&&<ul className="grid gap-2 sm:grid-cols-2">{c.latest.layers.map(l=><li key={l.layer} className="rounded-lg bg-[var(--paper)] p-3"><strong>{layerLabels[l.layer]}：{stateLabels[l.state]}</strong><p className="text-sm text-[var(--muted)]">{l.description}</p></li>)}</ul>}</>:<p className="text-sm text-[var(--muted)]">尚无已保存观察。允许读取后，Agent 才能在原讨论或委托中检查。</p>}
        <div className="flex flex-wrap gap-2">{c.status==="ACTIVE"&&<><button className="editorial-button focus-ring min-h-11 disabled:opacity-50" disabled={disabled||!data.enabled||Date.parse(c.config.expiresAt)<=clock} onClick={()=>void discuss(c)}>交给忆程调查</button><button className={button} disabled={disabled||!data.enabled} onClick={()=>edit(c)}>修订只读许可</button><button className={button} disabled={disabled} onClick={()=>void submit({method:"PATCH",path:`/api/projects/${projectId}/deployment-connections/${c.id}`,body:{requestId:crypto.randomUUID(),expectedVersion:c.revision,action:"REVOKE"}})}>撤销读取</button></>}</div>
      </article>;})}
    {pending&&<button className={button} disabled={busy} onClick={()=>void submit(pending)}>核对上次授权结果</button>}
    {!editing&&data.enabled&&<button className={button} disabled={disabled} onClick={()=>edit(null)}>连接一个只读环境</button>}
    {editing&&<form className="grid gap-4 rounded-lg bg-[var(--paper)] p-3 sm:p-4" onSubmit={e=>{e.preventDefault();const config={schemaVersion:1,environment,origin,expectedRelease:release,healthPath:health,...(userPath?{userPath}:{}),...(logPath?{logPath}:{}),expiresAt:new Date(until).toISOString(),freshnessSeconds:editSnapshot?.config.freshnessSeconds??600};void submit({method:editSnapshot?"PATCH":"POST",path:`/api/projects/${projectId}/deployment-connections${editSnapshot?"/"+editSnapshot.id:""}`,body:{requestId:crypto.randomUUID(),confirmedReadOnly:true,config,...(editSnapshot?{expectedVersion:editSnapshot.revision,action:"REVISE"}:{})}});}}>
      <label className="block text-sm font-medium">环境名<input className={input} required disabled={disabled||Boolean(editSnapshot)} value={environment} onChange={e=>setEnvironment(e.target.value)} maxLength={80}/></label>
      <label className="block text-sm font-medium">公开 HTTPS 服务地址<input className={input} type="url" required disabled={disabled} value={origin} onChange={e=>setOrigin(e.target.value)} placeholder="https://service.example.org"/></label>
      <label className="block text-sm font-medium">期望版本号或提交 SHA<input className={input} required disabled={disabled} value={release} onChange={e=>setRelease(e.target.value)} minLength={7} maxLength={80}/></label>
      <fieldset className="flex flex-wrap gap-2"><legend className="mb-2 text-sm font-medium">许可时长</legend><button className={button} type="button" disabled={disabled} onClick={()=>setUntil(localInput(new Date(Date.now()+86400000).toISOString()))}>24 小时</button><button className={button} type="button" disabled={disabled} onClick={()=>setUntil(localInput(new Date(Date.now()+7*86400000).toISOString()))}>7 天</button></fieldset><label className="block text-sm font-medium">读取许可到期时间<input className={input} type="datetime-local" required disabled={disabled} value={until} onChange={e=>setUntil(e.target.value)}/></label>
      <details><summary className="focus-ring cursor-pointer py-2">高级设置 · 固定读取路径</summary><div className="grid gap-3 py-2"><label className="block text-sm font-medium">自检 JSON 路径<input className={input} required disabled={disabled} value={health} onChange={e=>setHealth(e.target.value)}/><span className="mt-1 block font-normal text-[var(--muted)]">检查返回 status、release、checked_at；日志返回 lines 数组。</span></label><label className="block text-sm font-medium">公共用户路径（可选）<input className={input} disabled={disabled} value={userPath} onChange={e=>setUserPath(e.target.value)}/></label><label className="block text-sm font-medium">公开日志 JSON 路径（可选，另行允许读取）<input className={input} disabled={disabled} value={logPath} onChange={e=>setLogPath(e.target.value)}/></label></div></details>
      <p className="text-sm text-[var(--muted)]">仅允许读取这些公开路径，不携带凭据。连接后由原讨论或委托发起调查，随时可以撤销。</p>
      {editSnapshot&&data.connections.find(c=>c.id===editSnapshot.id)?.revision!==editSnapshot.revision&&<button className={button} type="button" disabled={disabled} onClick={()=>{const current=data.connections.find(c=>c.id===editSnapshot.id);if(current)setEditSnapshot(current);}}>核对最新授权版本，保留修改</button>}
      <div className="flex flex-wrap gap-2"><button className="editorial-button focus-ring min-h-11 disabled:opacity-50" type="submit" disabled={disabled}>确认这些路径的只读许可</button><button className={button} type="button" disabled={disabled} onClick={()=>setEditing(false)}>取消</button></div>
    </form>}
    {busy&&<p role="status" className="text-sm text-[var(--muted)]">正在核对，请稍候…</p>}{error&&<p role="alert" className="text-sm text-[var(--brick)]">{error}</p>}
  </div></details>;
}
