"use client";
import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {useEffect,useState} from "react";
import {getDeviceKey} from "@/lib/client/deviceKey";
import type {ProjectStateDiff} from "@/lib/types/projectState";
import styles from "./ProjectWorkspace.module.css";

/** Read existing observations. Viewing the overview never refreshes or acknowledges a snapshot. */
export function ProjectEvolutionSummary({projectId}:{projectId:string}) {
  const [attempt,setAttempt]=useState(0);
  const [view,setView]=useState<{at:string|null;from:string|null;to:string|null;diff:ProjectStateDiff|null;error:string;warning:string;loading:boolean}>({at:null,from:null,to:null,diff:null,error:"",warning:"",loading:true});
  useEffect(()=>{
    let live=true;
    async function read(){
      try{
        const response=await fetch(`/api/projects/${projectId}/state?consumerKey=${encodeURIComponent(getDeviceKey())}`);
        const value=await response.json();if(!response.ok)throw new Error(response.status===401?"请重新登录后查看项目观察":"暂时未能读取项目观察");
        const snapshot=value.snapshot,from=value.lastSeenSnapshotId??null;let diff:ProjectStateDiff|null=null;let warning="";
        if(snapshot&&from&&from!==snapshot.id){
          try {const r=await fetch(`/api/projects/${projectId}/state/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(snapshot.id)}`);const v=await r.json();if(r.status===401||r.status===403)throw Object.assign(new Error("请重新登录或核对项目权限"),{unauthorized:true});if(!r.ok)throw new Error("差异暂未加载");diff=v.diff;}
          catch(e){if(e instanceof Error&&"unauthorized" in e)throw e;warning="已有快照仍可查看，差异暂未加载；不能据此判断没有变化。";}
        }
        if(live)setView({at:snapshot?.evaluatedAt??null,from,to:snapshot?.id??null,diff,error:"",warning,loading:false});
      }catch(e){if(live)setView({at:null,from:null,to:null,diff:null,error:e instanceof Error?e.message:"项目观察读取失败",warning:"",loading:false});}
    }
    void read();return()=>{live=false;};
  },[projectId,attempt]);
  return <section className={styles.summary} aria-label="最近重要变化"><div className={styles.summaryHeading}><h3>最近重要变化</h3><Link href={`/projects/${projectId}/health#project-state`}>查看状态与依据<ArrowRight size={13} aria-hidden="true"/></Link></div>
    {view.loading?<p className={styles.empty}>正在读取已有项目观察…</p>:view.error?<p className={styles.empty} role="status">{view.error}。</p>:<>
      {view.at&&<p className={styles.empty}>观察于 {new Date(view.at).toLocaleString("zh-CN")}；当前有效性以来源核对为准。</p>}
      {view.warning?<p className={styles.empty} role="status">{view.warning}</p>:view.diff?<><p className={styles.empty}>相较已了解快照 → 当前保存快照</p><ul>{view.diff.items.slice(0,3).map(item=><li key={item.changeKey}><Link href={`/projects/${projectId}/health#project-state`}><strong>{item.summary}</strong><p>{item.before??"未记录"} → {item.after??"未记录"}</p></Link></li>)}</ul>{!view.diff.items.length&&<p className={styles.empty}>这两份快照未记录到状态差异。</p>}</>:<p className={styles.empty}>{!view.to?"尚无状态观察，可到状态详情建立基线。":!view.from?"尚无已了解的比较基线；先查看当前记录。":"当前已了解这份快照；新资料仍需重新评估。"}</p>}
    </>}
    {(view.warning||view.error)&&<button className="focus-ring editorial-button-secondary" onClick={()=>{setView(v=>({...v,loading:true,error:"",warning:""}));setAttempt(n=>n+1);}}>重新读取项目观察</button>}
    <Link className={styles.historyLink} href={`/projects/${projectId}/health#project-evolution`}>查看结论演进与阶段检查点<ArrowRight size={13} aria-hidden="true"/></Link>
  </section>;
}
