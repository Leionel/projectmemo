import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {isFeatureEnabled} from "@/lib/config/features";
import {projectHref} from "@/lib/projectNavigation";
import {isInterventionActive,sortActions} from "@/lib/projectDashboard";
import {requireWorkspaceProject,loadWorkspaceOverview} from "@/lib/server/projectWorkspace";
import {missionWorkspaceSummary} from "@/lib/mission/workspaceSummary";
import {missionStatusLabels,type MissionWorkspaceSummary} from "@/lib/mission/presentation";
import {ProjectPulse} from "@/components/ProjectPulse";
import {ProjectLegacyRedirect} from "@/components/ProjectNavigation";
import {ProjectEvolutionSummary} from "@/components/ProjectEvolutionSummary";
import {ReentryBrief} from "@/components/ReentryBrief";
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectHome({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const {user,missionOwner}=await requireWorkspaceProject(id);
 const {project,actions,interventions,dashboard}=await loadWorkspaceOverview(id),base=`/projects/${id}`;
 let summary:MissionWorkspaceSummary={enabled:false,totalActive:0,items:[]};let missionError=false;
 if(missionOwner)try{summary=await missionWorkspaceSummary(user.id,id);}catch{missionError=true;}
 const important=interventions.filter(i=>!i.isSimulated&&isInterventionActive(i)).slice(0,3);
 const nextActions=sortActions(actions.filter(a=>!a.isSimulated&&["TODO","DOING"].includes(a.status)),"smart").slice(0,3);
 const first=summary.items[0],respond=first&&["WAITING_INPUT","WAITING_APPROVAL","PAUSED","FAILED"].includes(first.status);
 const missionHref=first?`${base}/missions?mission=${encodeURIComponent(first.id)}`:`${base}/missions`;
 const neutral=dashboard.nextAction.detail.startsWith("参赛准备度")&&project.scenario!=="COMPETITION";
 const focus=respond?{eyebrow:missionStatusLabels[first.status],title:first.attention??first.goal,detail:first.goal,href:missionHref,action:first.status==="WAITING_INPUT"?"补充信息":first.status==="WAITING_APPROVAL"?"审阅行动提案":"查看原因与进度"}
 :first&&dashboard.deadline.rank<3&&dashboard.highestReminderSeverity<4?{eyebrow:"当前委托",title:first.goal,detail:first.activity??missionStatusLabels[first.status],href:missionHref,action:"查看委托进度"}
 :{eyebrow:project.cards.length?"建议下一步":"从第一条资料开始",title:neutral?"整理当前项目资料":dashboard.nextAction.label,detail:neutral?"记录进展、查看已有记忆，或委托一个长期目标。":dashboard.nextAction.detail,href:neutral?`${base}/records`:projectHref(id,dashboard.nextAction.href),action:neutral?"记录项目进展":"查看下一步"};
 return <>
  <ProjectLegacyRedirect projectId={id}/>
  <header className={styles.pageTitle}><h2>项目概览</h2><div className={styles.quickActions}><Link href={`${base}/records`}>记录进展</Link><Link href={`${base}/knowledge?openCopilot=1#memory-copilot`}>问忆程</Link></div></header>
  <section className={styles.focus} aria-label="当前最重要的事项"><small>{focus.eyebrow}</small><h3>{focus.title}</h3><p>{focus.detail}</p><Link className="focus-ring editorial-button" prefetch={false} href={focus.href}>{focus.action}<ArrowRight size={17} aria-hidden="true"/></Link>{summary.totalActive>1&&<Link className={styles.otherTasks} href={`${base}/missions`}>查看全部 {summary.totalActive} 项未结束委托</Link>}</section>
  {missionError&&<p className={styles.empty} role="status">委托摘要暂时未能加载。<Link href={`${base}/missions`}>进入委托重试</Link></p>}
  {isFeatureEnabled("PROJECT_STATE_ENABLED",false)&&<ProjectEvolutionSummary key={id} projectId={id}/>}
  <div className={styles.overviewColumns}>
   {important.length>0&&<section className={styles.summary} aria-label="重要提醒"><div className={styles.summaryHeading}><h3>需要关注</h3><Link href={`${base}/actions#interventions`}>查看全部</Link></div><ul>{important.map(i=><li key={i.id}><Link href={`${base}/actions#intervention-${i.id}`}><strong>{i.title}</strong><p>{i.content}</p></Link></li>)}</ul></section>}
   {summary.enabled&&<section className={styles.summary} aria-label="当前委托"><div className={styles.summaryHeading}><h3>当前委托</h3><Link href={`${base}/missions`}>查看全部</Link></div>{summary.items.length?<ul>{summary.items.map(m=><li key={m.id}><Link href={`${base}/missions?mission=${encodeURIComponent(m.id)}`}><strong>{m.goal}</strong><p>{missionStatusLabels[m.status]??"状态待确认"}{m.attention&&m.id!==first?.id?` · ${m.attention}`:""}</p>{m.activity&&<p>{m.activity}{m.activityAt?` · ${new Date(m.activityAt).toLocaleString("zh-CN")}`:""}</p>}</Link></li>)}</ul>:<p className={styles.empty}>已有资料可以作为委托的起点。<Link href={`${base}/missions`}>委托第一个目标</Link></p>}</section>}
   {nextActions.length>0&&<section className={styles.summary} aria-label="接下来要做"><div className={styles.summaryHeading}><h3>接下来要做</h3><Link href={`${base}/actions#action-board`}>行动板</Link></div><ul>{nextActions.map(a=><li key={a.id}><Link href={`${base}/actions#action-${a.id}`}><strong>{a.title}</strong><p>{a.status==="DOING"?"进行中":"待开始"}{a.dueAt?` · ${new Date(a.dueAt).toLocaleDateString("zh-CN")} 截止`:" · 未设截止"}</p></Link></li>)}</ul></section>}
   {project.cards.length>0&&<section className={styles.summary} aria-label="最近记录"><div className={styles.summaryHeading}><h3>最近记录</h3><Link href={`${base}/records`}>查看资料</Link></div><ul>{project.cards.slice(0,3).map(c=><li key={c.id}><Link href={`${base}/knowledge#card-${c.id}`}><strong>{c.title}</strong><p>{c.createdAt.toLocaleDateString("zh-CN")} · {c.summary}</p></Link></li>)}</ul></section>}
  </div>
  {isFeatureEnabled("PROJECT_REENTRY_ENABLED",false)&&<details className={styles.secondary}><summary>项目变化与再进入摘要</summary><ReentryBrief projectId={id} enabled episodesEnabled={isFeatureEnabled("PROJECT_EPISODES_ENABLED",false)} stateEnabled={isFeatureEnabled("PROJECT_STATE_ENABLED",false)} schedulingEnabled={isFeatureEnabled("PROJECT_SCHEDULING_ENABLED",false)}/></details>}
  <details className={styles.secondary}><summary>更多项目状态与目标</summary><p className={styles.empty}>{project.goal}</p><ProjectPulse dashboard={dashboard} competition={project.scenario==="COMPETITION"} goal={project.goal} deadlineLabel={project.deadline?.toLocaleDateString("zh-CN")??"暂未设置"}/><Link href={`${base}/health`}>项目体检、变化与阶段检查</Link></details>
 </>;
}
