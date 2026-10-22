"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useEffect} from "react";
import {Plus,MessageSquare} from "lucide-react";

export function ProjectOverviewToolbar({projectId}:{projectId:string}) {
 const router=useRouter(),ask=`/projects/${projectId}/knowledge?openCopilot=1#memory-copilot`;
 useEffect(()=>{
  const shortcut=(event:KeyboardEvent)=>{
   const target=event.target;
   if(event.repeat||event.altKey||!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=="j")return;
   if(target instanceof HTMLElement&&target.closest('input,textarea,select,[contenteditable="true"]'))return;
   event.preventDefault();router.push(ask);
  };
  window.addEventListener("keydown",shortcut);return()=>window.removeEventListener("keydown",shortcut);
 },[ask,router]);
 return <div className="flex flex-wrap items-center gap-2" aria-label="项目快捷操作">
  <Link href={`/projects/${projectId}/records#capture-box`} className="workspace-tool"><Plus size={14} aria-hidden="true"/>记录进展</Link>
  <Link href={ask} className="workspace-tool workspace-tool-tinted" aria-keyshortcuts="Control+j Meta+j"><MessageSquare size={14} aria-hidden="true"/>问忆程<kbd className="ml-1 hidden font-mono text-[11px] opacity-65 sm:inline">⌘/Ctrl J</kbd></Link>
 </div>;
}
