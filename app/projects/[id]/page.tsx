import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {isFeatureEnabled} from "@/lib/config/features";
import {isInterventionActive,sortActions} from "@/lib/projectDashboard";
import {requireWorkspaceProject,loadWorkspaceOverview} from "@/lib/server/projectWorkspace";
import {missionWorkspaceSummary} from "@/lib/mission/workspaceSummary";
import {missionStatusLabels,type MissionWorkspaceSummary} from "@/lib/mission/presentation";
import {ProjectPulse} from "@/components/ProjectPulse";
import {ProjectLegacyRedirect} from "@/components/ProjectNavigation";
import {ProjectEvolutionSummary} from "@/components/ProjectEvolutionSummary";
import {ReentryBrief} from "@/components/ReentryBrief";
import {selectProjectFocus} from "@/lib/projectAttention";
import {ProjectStartGuide} from "@/components/ProjectStartGuide";
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectHome({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const {user,missionOwner}=await requireWorkspaceProject(id);
 const {project,actions,interventions,dashboard}=await loadWorkspaceOverview(id),base=`/projects/${id}`;
 let summary:MissionWorkspaceSummary={enabled:false,totalActive:0,items:[]};let missionError=false;
 if(missionOwner)try{summary=await missionWorkspaceSummary(user.id,id);}catch{missionError=true;}
 const important=interventions.filter(i=>!i.isSimulated&&isInterventionActive(i)).sort((a,b)=>b.severity-a.severity).slice(0,3);
 const nextActions=sortActions(actions.filter(a=>!a.isSimulated&&["TODO","DOING"].includes(a.status)),"smart").slice(0,3);
 const first=summary.items[0];
 const missionHref=first?`${base}/missions?mission=${encodeURIComponent(first.id)}`:`${base}/missions`;
 const kind=selectProjectFocus(first?.status??"",important[0]?.severity??0,dashboard.deadline.rank,nextActions.length>0);
 const focus=kind==="reminder"?{eyebrow:"需要关注",title:important[0].title,detail:important[0].content,href:`${base}/actions#intervention-${important[0].id}`,action:"查看提醒依据"}
 :kind==="mission"&&first?{eyebrow:missionStatusLabels[first.status],title:first.attention??first.goal,detail:first.attention?first.goal:first.activity??"步骤与草稿保留在原委托中。",href:missionHref,action:first.status==="WAITING_INPUT"?"补充信息":first.status==="WAITING_APPROVAL"?"审阅行动提案":"查看原因与进度"}
 :kind==="deadline"?{eyebrow:"项目截止",title:dashboard.deadline.label,detail:"核对剩余行动和项目目标，决定本次先推进什么。",href:`${base}/actions#action-board`,action:"查看剩余行动"}
 :kind==="action"?{eyebrow:nextActions[0].status==="DOING"?"继续行动":"下一项行动",title:nextActions[0].title,detail:nextActions[0].description??"查看行动要求，完成后记录实际结果。",href:`${base}/actions#action-${nextActions[0].id}`,action:"查看行动"}
 :{eyebrow:project.cards.length?"继续项目":"从第一条资料开始",title:project.cards.length?"记录新进展，或继续一个长期目标":"先留下一条真实的项目资料",detail:project.cards.length?"已有记忆可以查阅；把接下来要完成的目标交给忆程。":"记录已完成的事、实验结果或会议要求，让后续判断有据可查。",href:`${base}/records`,action:project.cards.length?"记录项目进展":"记录第一条资料"};
 const waiting=summary.items.filter(m=>["WAITING_INPUT","WAITING_APPROVAL","PAUSED","FAILED"].includes(m.status)&&!(kind==="mission"&&m.id===first?.id));
 const reminders=important.filter(i=>!(kind==="reminder"&&i.id===important[0]?.id));
 const continuing=summary.items.filter(m=>!["WAITING_INPUT","WAITING_APPROVAL","PAUSED","FAILED"].includes(m.status)&&!(kind==="mission"&&m.id===first?.id));
 const remainingActions=nextActions.filter(a=>!(kind==="action"&&a.id===nextActions[0]?.id));
 return <>
  <ProjectLegacyRedirect projectId={id}/>
  <header className={styles.pageTitle}><h2>项目概览</h2><div className={styles.quickActions}><Link href={`${base}/records`}>记录进展</Link><Link href={`${base}/knowledge?openCopilot=1#memory-copilot`}>问忆程</Link></div></header>
  <div className={styles.overviewLayout}><div className={styles.overviewMain}>
  <section className={styles.focus} aria-label="当前最重要的事项"><small>{focus.eyebrow}</small><h3>{focus.title}</h3><p>{focus.detail}</p><Link className="focus-ring editorial-button" prefetch={false} href={focus.href}>{focus.action}<ArrowRight size={17} aria-hidden="true"/></Link>{summary.totalActive>1&&<Link className={styles.otherTasks} href={`${base}/missions`}>查看全部 {summary.totalActive} 项未结束委托</Link>}</section>
  {missionError&&<p className={styles.empty} role="status">委托摘要暂时未能加载。<Link href={`${base}/missions`}>进入委托重试</Link></p>}
  <ProjectStartGuide projectId={id} hasRecords={project._count.captures>0} hasCards={project.cards.length>0} missionsEnabled={summary.enabled} hasActiveMission={summary.totalActive>0||missionError} stateEnabled={isFeatureEnabled("PROJECT_STATE_ENABLED",false)}/>
  {(waiting.length>0||reminders.length>0)&&<section className={styles.summary} aria-label="需要你处理"><div className={styles.summaryHeading}><h3>需要你处理</h3><span>打开原任务继续处理</span></div><ul>{waiting.map(m=><li key={m.id}><Link href={`${base}/missions?mission=${encodeURIComponent(m.id)}`}><small>{missionStatusLabels[m.status]}</small><strong>{m.attention??m.goal}</strong><p>{m.attention?m.goal:"查看原因后决定是否继续原委托。"}</p></Link></li>)}{reminders.map(i=><li key={i.id}><Link href={`${base}/actions#intervention-${i.id}`}><small>提醒待处理</small><strong>{i.title}</strong><p>{i.content}</p></Link></li>)}</ul></section>}
   {continuing.length>0&&<section className={styles.summary} aria-label="当前委托"><div className={styles.summaryHeading}><h3>继续委托</h3><Link href={`${base}/missions`}>查看全部</Link></div><ul>{continuing.map(m=><li key={m.id}><Link href={`${base}/missions?mission=${encodeURIComponent(m.id)}`}><strong>{m.goal}</strong><p>{missionStatusLabels[m.status]??"状态待确认"}</p>{m.activity&&<p>{m.activity}{m.activityAt?` · ${new Date(m.activityAt).toLocaleString("zh-CN")}`:""}</p>}</Link></li>)}</ul></section>}
   {remainingActions.length>0&&<section className={styles.summary} aria-label="接下来要做"><div className={styles.summaryHeading}><h3>接下来要做</h3><Link href={`${base}/actions#action-board`}>行动板</Link></div><ul>{remainingActions.map(a=><li key={a.id}><Link href={`${base}/actions#action-${a.id}`}><strong>{a.title}</strong><p>{a.status==="DOING"?"进行中":"待开始"}{a.dueAt?` · ${new Date(a.dueAt).toLocaleDateString("zh-CN")} 截止`:" · 未设截止"}</p></Link></li>)}</ul></section>}
  </div><aside className={styles.overviewAside} aria-label="项目近期记录">
  {isFeatureEnabled("PROJECT_STATE_ENABLED",false)&&(project._count.captures>0||project.cards.length>0||actions.length>0||project._count.artifacts>0)&&<ProjectEvolutionSummary key={id} projectId={id}/>}
   {project.cards.length>0&&<section className={styles.summary} aria-label="最近记录"><div className={styles.summaryHeading}><h3>最近记录</h3><Link href={`${base}/records`}>查看资料</Link></div><ul>{project.cards.slice(0,3).map(c=><li key={c.id}><Link href={`${base}/knowledge#card-${c.id}`}><strong>{c.title}</strong><p>{c.createdAt.toLocaleDateString("zh-CN")} · {c.summary}</p></Link></li>)}</ul></section>}
  </aside></div>
  {isFeatureEnabled("PROJECT_REENTRY_ENABLED",false)&&<details className={styles.secondary}><summary>项目变化与再进入摘要</summary><ReentryBrief projectId={id} enabled episodesEnabled={isFeatureEnabled("PROJECT_EPISODES_ENABLED",false)} stateEnabled={isFeatureEnabled("PROJECT_STATE_ENABLED",false)} schedulingEnabled={isFeatureEnabled("PROJECT_SCHEDULING_ENABLED",false)}/></details>}
  <details className={styles.secondary}><summary>更多项目状态与目标</summary><p className={styles.empty}>{project.goal}</p><ProjectPulse dashboard={dashboard} competition={project.scenario==="COMPETITION"} goal={project.goal} deadlineLabel={project.deadline?.toLocaleDateString("zh-CN")??"暂未设置"}/><Link href={`${base}/health`}>项目体检、变化与阶段检查</Link></details>
 </>;
}
