import Link from "next/link";
import {ArrowRight} from "lucide-react";
import {db} from "@/lib/db";
import {isFeatureEnabled} from "@/lib/config/features";
import {projectHref} from "@/lib/projectNavigation";
import {isInterventionActive,sortActions} from "@/lib/projectDashboard";
import {requireWorkspaceProject,loadWorkspaceOverview} from "@/lib/server/projectWorkspace";
import {ProjectPulse} from "@/components/ProjectPulse";
import {ProjectLegacyRedirect} from "@/components/ProjectNavigation";
import {ReentryBrief} from "@/components/ReentryBrief";
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectHome({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const {user,missionOwner}=await requireWorkspaceProject(id);
 const {project,actions,interventions,dashboard}=await loadWorkspaceOverview(id),base=`/projects/${id}`;
 const missionsEnabled=missionOwner&&isFeatureEnabled("MISSION_ENABLED",false);
 const missions=missionsEnabled?await db.agentMission.findMany({where:{projectId:id,ownerUserId:user.id,status:{notIn:["SUCCEEDED","CANCELLED"]}},orderBy:{updatedAt:"desc"},take:3,select:{id:true,goal:true,status:true}}):[];
 const important=interventions.filter(i=>!i.isSimulated&&isInterventionActive(i)).slice(0,3);
 const nextActions=sortActions(actions.filter(a=>!a.isSimulated&&["TODO","DOING"].includes(a.status)),"smart").slice(0,3);
 const missionStatus:Record<string,string>={WAITING_INPUT:"需要补充信息",WAITING_APPROVAL:"需要你的批准",PAUSED:"已暂停，查看原因",READY:"准备执行",RUNNING:"正在执行",FAILED:"执行失败"};
 return <>
  <ProjectLegacyRedirect projectId={id}/>
  <header className={styles.pageTitle}><h2>项目首页</h2><p>当前目标：{project.goal}</p></header>
  <ProjectPulse dashboard={dashboard} goal={project.goal} deadlineLabel={project.deadline?.toLocaleDateString("zh-CN")??"暂未设置"}/>
  <Link className={styles.next} href={projectHref(id,dashboard.nextAction.href)}><span><small>建议下一步</small><strong>{dashboard.nextAction.label}</strong><p>{dashboard.nextAction.detail}</p></span><ArrowRight size={19} className="shrink-0"/></Link>
  <div className={styles.overviewColumns}>
   <section className={styles.summary} aria-label="重要提醒"><div className={styles.summaryHeading}><h3>重要提醒</h3><Link href={`${base}/actions#interventions`}>查看全部</Link></div>{important.length?<ul>{important.map(i=><li key={i.id}><Link href={`${base}/actions#intervention-${i.id}`}><strong>{i.title}</strong><p>{i.content}</p></Link></li>)}</ul>:<p className={styles.empty}>当前没有需要处理的真实提醒。</p>}</section>
   <section className={styles.summary} aria-label="接下来要做"><div className={styles.summaryHeading}><h3>接下来要做</h3><Link href={`${base}/actions#action-board`}>行动板</Link></div>{nextActions.length?<ul>{nextActions.map(a=><li key={a.id}><Link href={`${base}/actions#action-${a.id}`}><strong>{a.title}</strong><p>{a.status==="DOING"?"进行中":"待开始"}{a.dueAt?` · ${new Date(a.dueAt).toLocaleDateString("zh-CN")} 截止`:" · 未设截止时间"}</p></Link></li>)}</ul>:<p className={styles.empty}>还没有待推进的行动。可以先记录项目进展，或前往行动板创建待办。</p>}</section>
   {missionsEnabled&&<section className={styles.summary} aria-label="当前委托"><div className={styles.summaryHeading}><h3>当前委托</h3><Link href={`${base}/missions`}>进入长期委托</Link></div>{missions.length?<ul>{missions.map(m=><li key={m.id}><Link href={`${base}/missions?mission=${encodeURIComponent(m.id)}`}><strong>{m.goal}</strong><p>{missionStatus[m.status]??"查看进度"}</p></Link></li>)}</ul>:<p className={styles.empty}>把一个长期目标交给 Agent，执行进度和草稿会保存在同一委托中。</p>}</section>}
   <section className={styles.summary} aria-label="最近记录"><div className={styles.summaryHeading}><h3>最近记录</h3><Link href={`${base}/records`}>记录新进展</Link></div>{project.cards.length?<ul>{project.cards.slice(0,3).map(c=><li key={c.id}><Link href={`${base}/knowledge#card-${c.id}`}><strong>{c.title}</strong><p>{c.createdAt.toLocaleDateString("zh-CN")} · {c.summary}</p></Link></li>)}</ul>:<p className={styles.empty}>记录一次实验、一条建议或一份材料，逐步建立项目记忆。</p>}</section>
  </div>
  <div className={styles.secondary}><Link href={`${base}/generate`} className="focus-ring editorial-button-secondary">生成项目成果</Link><Link href={`${base}/knowledge?openCopilot=1#memory-copilot`} className="focus-ring ml-3 text-sm text-[var(--teal-strong)]">问忆程</Link></div>
  {isFeatureEnabled("PROJECT_REENTRY_ENABLED",false)&&<details className={styles.secondary}><summary>查看上次进度与项目变化</summary><ReentryBrief projectId={id} enabled episodesEnabled={isFeatureEnabled("PROJECT_EPISODES_ENABLED",false)} stateEnabled={isFeatureEnabled("PROJECT_STATE_ENABLED",false)} schedulingEnabled={isFeatureEnabled("PROJECT_SCHEDULING_ENABLED",false)}/></details>}
 </>;
}
