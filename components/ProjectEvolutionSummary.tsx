"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {getDeviceKey} from "@/lib/client/deviceKey";
import type {ProjectStateDiff} from "@/lib/types/projectState";
import styles from "./ProjectWorkspace.module.css";

/** Read existing observations. Viewing the overview never refreshes or acknowledges a snapshot. */
export function ProjectEvolutionSummary({projectId}:{projectId:string}) {
  const [view,setView]=useState<{at:string|null;from:string|null;to:string|null;diff:ProjectStateDiff|null;error:string;loading:boolean}>({at:null,from:null,to:null,diff:null,error:"",loading:true});
  useEffect(()=>{
    let live=true;
    async function read(){
      try{
        const response=await fetch(`/api/projects/${projectId}/state?consumerKey=${encodeURIComponent(getDeviceKey())}`);
        const value=await response.json();if(!response.ok)throw new Error(value.error?.message??"暂时未能读取项目观察");
        const snapshot=value.snapshot,from=value.lastSeenSnapshotId??null;let diff:ProjectStateDiff|null=null;
        if(snapshot&&from&&from!==snapshot.id){const r=await fetch(`/api/projects/${projectId}/state/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(snapshot.id)}`);const v=await r.json();if(!r.ok)throw new Error(v.error?.message??"暂时没有可比较的变化");diff=v.diff;}
        if(live)setView({at:snapshot?.evaluatedAt??null,from,to:snapshot?.id??null,diff,error:"",loading:false});
      }catch(e){if(live)setView({at:null,from:null,to:null,diff:null,error:e instanceof Error?e.message:"项目观察读取失败",loading:false});}
    }
    void read();return()=>{live=false;};
  },[projectId]);
  return <section className={styles.summary} aria-label="最近重要变化"><div className={styles.summaryHeading}><h3>最近重要变化</h3><Link href={`/projects/${projectId}/health#project-state`}>查看状态与依据</Link></div>
    {view.loading?<p className={styles.empty}>正在读取已有项目观察…</p>:view.error?<p className={styles.empty} role="status">{view.error}，可进入状态详情重试。</p>:<>
      {view.at&&<p className={styles.empty}>观察于 {new Date(view.at).toLocaleString("zh-CN")}；当前有效性以来源核对为准。</p>}
      {view.diff?<><p className={styles.empty}>相较已了解快照 → 当前保存快照</p><ul>{view.diff.items.slice(0,3).map(item=><li key={item.changeKey}><Link href={`/projects/${projectId}/health#project-state`}><strong>{item.summary}</strong><p>{item.before??"未记录"} → {item.after??"未记录"}</p></Link></li>)}</ul>{!view.diff.items.length&&<p className={styles.empty}>这两份快照未记录到状态差异。</p>}</>:<p className={styles.empty}>{!view.to?"尚无状态观察，可到状态详情建立基线。":!view.from?"尚无已了解的比较基线；先查看当前记录。":"当前已了解这份快照；新资料仍需重新评估。"}</p>}
    </>}
  </section>;
}
