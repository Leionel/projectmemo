"use client";
import { useEffect,useState } from "react";
import { useParams } from "next/navigation";
import { DocumentSourceView } from "@/components/DocumentSourceView";
import type { ConversationSource } from "@/lib/types/conversation";
export default function MissionDocumentSourcePage(){
 const p=useParams<{missionId:string;sourceId:string}>(),[source,setSource]=useState<ConversationSource|null>(null),[error,setError]=useState("");
 useEffect(()=>{const abort=new AbortController();void fetch(`/api/missions/${encodeURIComponent(p.missionId)}/sources/${encodeURIComponent(decodeURIComponent(p.sourceId))}`,{signal:abort.signal}).then(async r=>{const body=await r.json();if(!r.ok)throw new Error(body.error?.message??"文档来源不可访问");setSource(body.source);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[p.missionId,p.sourceId]);
 return <main className="mx-auto max-w-3xl px-6 py-10">{error?<p role="alert">{error}</p>:source?.document?<><a className="workspace-link" href={`/projects/${source.projectId}/missions?mission=${p.missionId}`}>← 返回原委托</a><h1 className="mt-5 text-2xl font-semibold">{source.title}</h1><DocumentSourceView projectId={source.projectId} document={source.document} text={source.excerpt}/></>:<p role="status">正在核对原文件版本…</p>}</main>;
}
