"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import {emitWorkspaceChange} from "@/lib/client/workspaceEvents";
import type {MissionWorkspaceItem} from "@/lib/mission/presentation";
export function ProjectAgentFocus({projectId,items,selected}:{projectId:string;items:MissionWorkspaceItem[];selected:string|null}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(""); const router=useRouter();
  async function change(value:string){setBusy(true);setError("");try{const response=await fetch(`/api/projects/${projectId}/agent-context`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({missionId:value||null})});const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"未能切换关注委托");emitWorkspaceChange(projectId,["projects"]);router.refresh();}catch(e){setError(e instanceof Error?e.message:"未能切换关注委托");}finally{setBusy(false);}}
  if(!items.length)return null;
  return <div className="text-xs text-[var(--ink-soft)]"><label className="flex flex-wrap items-center gap-2">当前关注委托<select aria-label="当前关注委托" className="focus-ring max-w-full rounded border border-[var(--rule)] bg-[var(--card-bg)] p-2" value={selected??""} disabled={busy} onChange={e=>void change(e.target.value)}><option value="">按待处理事项选择</option>{selected&&!items.some(i=>i.id===selected)&&<option value={selected}>已关注的原委托</option>}{items.map(i=><option key={i.id} value={i.id}>{i.goal}</option>)}</select></label><p className="mt-1">同类事项优先展示关注委托；补料、批准和失效来源仍先处理。</p>{error&&<p role="alert">{error}</p>}</div>;
}

export function ProjectAgentFocusButton({projectId,missionId}:{projectId:string;missionId:string}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  async function focus(){setBusy(true);try{const response=await fetch(`/api/projects/${projectId}/agent-context`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({missionId})});if(!response.ok)throw new Error("未能设置关注委托，请刷新后重试");setMessage("已设为当前关注；补料和批准仍会优先提示。");emitWorkspaceChange(projectId,["projects"]);}catch(e){setMessage(e instanceof Error?e.message:"设置失败");}finally{setBusy(false);}}
  return <div><button type="button" disabled={busy} className="workspace-tool focus-ring" onClick={()=>void focus()}>设为当前关注</button>{message&&<p role="status" className="text-xs text-[var(--ink-soft)]">{message}</p>}</div>;
}
