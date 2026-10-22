"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import type {TemporalTimelineResponse} from "@/lib/types";
import styles from "./ProjectWorkspace.module.css";

const relationLabels:Record<string,string>={RELATED:"关联",SUPPORTS:"支持",CONTRADICTS:"反驳",SUPERSEDES:"取代",DERIVED_FROM:"源自"};
/** Existing Ledger projection, loaded on demand. No historical-state reconstruction. */
export function ProjectDecisionTimeline({projectId}:{projectId:string}) {
 const [open,setOpen]=useState(false),[attempt,setAttempt]=useState(0),[limit,setLimit]=useState(10);
 const [view,setView]=useState<{data:TemporalTimelineResponse|null;error:string}>({data:null,error:""});
 useEffect(()=>{
  if(!open)return;const controller=new AbortController();
  void fetch(`/api/projects/${projectId}/decisions/timeline`,{signal:controller.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(r.status===401?"请重新登录后查看项目演进":"项目演进暂未加载，请重试");if(!controller.signal.aborted)setView({data:v,error:""});}).catch(e=>{if(!controller.signal.aborted)setView({data:null,error:e instanceof Error?e.message:"项目演进读取失败"});});
  return()=>controller.abort();
 },[open,attempt,projectId]);
 const items=view.data?[...view.data.items].sort((a,b)=>Date.parse(b.card.createdAt)-Date.parse(a.card.createdAt)):[];
 return <section className={styles.summary} id="project-evolution" aria-label="项目结论演进">
  <div className={styles.summaryHeading}><h3>项目结论演进</h3><button className="focus-ring editorial-button-secondary" aria-expanded={open} onClick={()=>{setView({data:null,error:""});setOpen(!open);}}>{open?"收起结论演进":"查看结论与关系记录"}</button></div>
  {open&&<>
   <p className={styles.empty}>按原始记录时间排列；每项状态来自当前 Ledger 核验，关系确认、撤销时间单独列出。</p>
   {view.error?<p role="status">{view.error} <button className="focus-ring editorial-button-secondary" onClick={()=>{setView({data:null,error:""});setAttempt(n=>n+1);}}>重新读取项目演进</button></p>:!view.data?<p role="status">正在读取已记录的结论与关系…</p>:<>
    {!view.data.enabled&&<p className={styles.empty}>时态关系评估当前关闭；下方仅供查看原始记录。</p>}
    {view.data.asOf&&<p className={styles.empty}>本次核验：{new Date(view.data.asOf).toLocaleString("zh-CN")}</p>}
    {!items.length?<p className={styles.empty}>尚无可展示的结论记录。<Link href={`/projects/${projectId}/records`}>记录第一条资料</Link></p>:<ol className={styles.evolutionList}>{items.slice(0,limit).map(item=><li key={item.card.id}>
     <time dateTime={item.card.createdAt}>记录于 {new Date(item.card.createdAt).toLocaleString("zh-CN")}</time>
     <Link href={`/projects/${projectId}/knowledge#card-${item.card.id}`}><strong>{item.card.title}</strong></Link>
     {view.data?.enabled&&<><p>当前核验：{item.statusLabel} · {item.displayReason}</p>{item.supersededBy&&<p>取代方向：<Link href={`/projects/${projectId}/knowledge#card-${item.supersededBy.id}`}>{item.supersededBy.title}</Link></p>}</>}
     {item.relations.length>0&&<details><summary>依据与关系（{item.relations.length}）</summary>{item.relations.map(relation=><div key={relation.id} className={styles.relation}>
      <p><Link href={`/projects/${projectId}/knowledge#card-${relation.currentCard.id}`}>{relation.currentCard.title}</Link> → {relationLabels[relation.relationType]??"关系"} → <Link href={`/projects/${projectId}/knowledge#card-${relation.relatedCard.id}`}>{relation.relatedCard.title}</Link></p>
      <p>{relation.reason||"未记录关系说明"}</p>
      <p>{relation.confirmedAt?`确认于 ${new Date(relation.confirmedAt).toLocaleString("zh-CN")}`:"尚未确认"}{relation.revokedAt?`；撤销于 ${new Date(relation.revokedAt).toLocaleString("zh-CN")}`:""}</p>
      {(relation.validFrom||relation.validTo)&&<p>有效范围：{relation.validFrom?new Date(relation.validFrom).toLocaleString("zh-CN"):"未设起点"} 至 {relation.validTo?new Date(relation.validTo).toLocaleString("zh-CN"):"未设终点"}</p>}
     </div>)}</details>}
    </li>)}</ol>}
    {items.length>limit&&<button className="focus-ring editorial-button-secondary" onClick={()=>setLimit(n=>n+10)}>继续查看结论记录（剩余 {items.length-limit}）</button>}
   </>}
  </>}
 </section>;
}
