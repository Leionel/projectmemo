"use client";
import { useState } from "react";
type Policy={mode:string;expiresAt?:string;maxModels?:number;maxTools?:number};
const reasonLabel:Record<string,string>={WAITING_INPUT:"需要补充原任务的信息",BUDGET_EXHAUSTED:"调查预算已用完",DELEGATION_EXPIRED:"调查许可已到期",DIRECTIVE_STOPPED:"你已暂停这项工作",INPUT_COVERAGE_LIMIT:"资料变化较多，需要核对调查范围"};
export function MissionInvestigationDelegation({id,version,policy,state,enabled,onSaved}:{id:string;version:number;policy?:Policy;state?:{attention?:{level:string;reason:string}|null}|null;enabled?:boolean;onSaved:()=>Promise<void>}){
  const [until,setUntil]=useState(""),[models,setModels]=useState(8),[tools,setTools]=useState(12),[web,setWeb]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  if(!enabled&&policy?.mode!=="BOUNDED_INVESTIGATION")return null;
  async function save(stop:boolean){setBusy(true);try{
    const value=stop?{mode:"MANUAL"}:{mode:"BOUNDED_INVESTIGATION",schemaVersion:1,expiresAt:new Date(until).toISOString(),checkEveryMinutes:5,maxModels:models,maxTools:tools,maxMetadataRequests:0,
      allowedTools:["inspect_project","search_memory","read_project_material","inspect_action","save_mission_output","propose_action",...(web?["web_search","web_fetch"]:[])],connectionIds:[],timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,quietStart:22,quietEnd:8,attention:"IMPORTANT_ONLY"};
    const response=await fetch(`/api/missions/${id}/continuation-policy`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({requestId:crypto.randomUUID(),expectedVersion:version,policy:value})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message??"许可未保存");await onSaved();setError("");
  }catch(e){setError(e instanceof Error?e.message:"许可未保存");}finally{setBusy(false);}}
  return <details><summary>持续调查与打扰方式</summary><div className="grid gap-3 py-3">
    <p>有新项目资料或已刷新的仓库线索时，接着调查原任务；需要决定时留在任务收件箱，22:00–08:00 排队。</p>
    {policy?.mode==="BOUNDED_INVESTIGATION"&&<p>已允许调查至 {new Date(policy.expiresAt!).toLocaleString("zh-CN")} · 原任务累计最多 {policy.maxModels} 次模型、{policy.maxTools} 次工具</p>}
    {state?.attention&&state.attention.level!=="SUPPRESS"&&<p role="status">{state.attention.level==="QUEUE"?"已排队：":"等待你处理："}{reasonLabel[state.attention.reason]??"调查许可或来源需要重新核对"}</p>}
    <label>调查到什么时候<input aria-label="持续调查截止时间" type="datetime-local" value={until} onChange={e=>setUntil(e.target.value)}/></label>
    <label>模型调用总上限<input aria-label="持续调查模型上限" type="number" min={1} max={24} value={models} onChange={e=>setModels(Number(e.target.value))}/></label>
    <label>工具调用总上限<input aria-label="持续调查工具上限" type="number" min={1} max={64} value={tools} onChange={e=>setTools(Number(e.target.value))}/></label>
    <label><input type="checkbox" checked={web} onChange={e=>setWeb(e.target.checked)}/>允许在原公开研究范围内继续搜索和读取</label>
    {error&&<p role="alert">{error}</p>}<div className="flex gap-4"><button disabled={busy||!until} onClick={()=>void save(false)}>允许按此期限和总预算持续调查</button>{policy?.mode==="BOUNDED_INVESTIGATION"&&<button disabled={busy} onClick={()=>void save(true)}>撤销持续调查</button>}</div>
  </div></details>;
}
