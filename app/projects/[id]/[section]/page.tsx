import {ProjectImpact} from "@/components/ProjectImpact";
import Link from "next/link";
import {notFound} from "next/navigation";
import {requireWorkspaceProject,loadWorkspaceOverview} from "@/lib/server/projectWorkspace";
import {getProjectDetail} from "@/lib/repositories/projects";
import {getDecisionTimeline} from "@/lib/services/temporalLedgerService";
import {isFeatureEnabled} from "@/lib/config/features";
import {projectSections,projectHref} from "@/lib/projectNavigation";
import {MissionPanel} from "@/components/MissionPanel";
import {ExperienceHistory} from "@/components/ExperienceHistory";
import {RepoSignalsCard} from "@/components/RepoSignalsCard";
import {CaptureBox} from "@/components/CaptureBox";
import {MissionMaterialIntake} from "@/components/MissionMaterialIntake";
import {MeetingImportCard} from "@/components/MeetingImportCard";
import {ActionBoard} from "@/components/ActionBoard";
import {InterventionPanel} from "@/components/InterventionPanel";
import {SchedulePlanner} from "@/components/SchedulePlanner";
import {KnowledgeFeed} from "@/components/KnowledgeFeed";
import {MemoryCopilot} from "@/components/MemoryCopilot";
import {ArchivedMemoryList} from "@/components/ArchivedMemoryList";
import {MemoryConsolidationCard} from "@/components/MemoryConsolidationCard";
import {ProjectStateCard} from "@/components/ProjectStateCard";
import {EpisodeCheckpointCard} from "@/components/EpisodeCheckpointCard";
import {ProjectHealthCard} from "@/components/ProjectHealthCard";
import {CompetitionReadiness} from "@/components/CompetitionReadiness";
import {AgentMetrics} from "@/components/AgentMetrics";
import {ProjectDecisionTimeline} from "@/components/ProjectDecisionTimeline";
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectFeaturePage({params,searchParams}:{params:Promise<{id:string;section:string}>;searchParams:Promise<{repo?:string;mission?:string;questionId?:string;approvalId?:string;outputId?:string;revision?:string;receiptId?:string;sourceId?:string}>}){
 const {id,section}=await params;
 const query=await searchParams;
 const item=projectSections.find(p=>p.key===section&&p.key!=="generate");if(!item)notFound();
 const workspace=await requireWorkspaceProject(id,section);
 if(section==="missions"&&!workspace.missionOwner)notFound();
 const enabled=(name:string,fallback=false)=>isFeatureEnabled(name,fallback),state=enabled("PROJECT_STATE_ENABLED"),reminders=enabled("PROJECT_CALENDAR_REMINDER_ENABLED");
 let content;
 if(section==="missions")content=enabled("MISSION_ENABLED")?<><MissionPanel key={workspace.user.id} projectId={id} initialMissionId={query.mission} readTarget={{questionId:query.questionId,approvalId:query.approvalId,outputId:query.outputId,revision:query.revision?Number(query.revision):undefined,receiptId:query.receiptId,sourceId:query.sourceId}}/><ExperienceHistory projectId={id}/></>:<p className={styles.empty}>长期委托当前未开启。已有委托数据仍保留。</p>;
 else if(section==="records")content=<>{workspace.missionOwner&&query.mission&&query.questionId?<MissionMaterialIntake key={`${workspace.user.id}:${query.mission}:${query.questionId}`} projectId={id} missionId={query.mission} questionId={query.questionId} ownerId={workspace.user.id} inboxEnabled={enabled("PROJECT_INBOX_ENABLED",true)}/>:<>{workspace.missionOwner&&enabled("REPO_SENSING_ENABLED",true)&&<RepoSignalsCard key={`${workspace.user.id}-${query.repo??"closed"}`} projectId={id} initialOpen={query.repo==="1"}/>}<CaptureBox key={workspace.user.id} projectId={id} inboxEnabled={enabled("PROJECT_INBOX_ENABLED",true)}/></>}<Link className="focus-ring editorial-button-secondary justify-self-start" href={`/projects/${id}/knowledge`}>查看已生成的知识资产</Link></>;
 else if(section==="meetings")content=<MeetingImportCard projectId={id} stateEnabled={state}/>;
 else if(section==="actions"){
  const data=await loadWorkspaceOverview(id);
  content=<><ActionBoard projectId={id} initialActions={data.actions} reminderEnabled={reminders}/><InterventionPanel projectId={id} initialInterventions={data.interventions} demoEnabled={process.env.DEMO_SCENARIOS!=="false"}/><SchedulePlanner projectId={id} enabled={enabled("PROJECT_SCHEDULING_ENABLED")}/></>;
 }else if(section==="knowledge"){
  const [project,timeline]=await Promise.all([getProjectDetail(id),getDecisionTimeline(id)]);const byId=new Map(timeline.items.map(i=>[i.card.id,i]));
  const cards=project.cards.map(card=>{const temporal=byId.get(card.id);return {...card,temporal:temporal?{topLevelState:temporal.topLevelState,reasonCode:temporal.reasonCode,displayReason:temporal.displayReason,evidenceRefs:temporal.evidenceRefs}:undefined};});
  content=<>{isFeatureEnabled("FOCUS_AGENT_ENABLED",false)?<details className={styles.secondary}><summary>历史项目问答</summary><MemoryCopilot key={workspace.user.id} projectId={id} historyOnly/></details>:<MemoryCopilot key={workspace.user.id} projectId={id}/>}<KnowledgeFeed projectId={id} cards={cards}/><ArchivedMemoryList projectId={id}/><MemoryConsolidationCard projectId={id} enabled={enabled("PROJECT_MEMORY_CONSOLIDATION_ENABLED")}/></>;
 }else if(section==="health"){
  const {dashboard,metrics}=await loadWorkspaceOverview(id);
  const readiness={...dashboard.readiness,items:dashboard.readiness.items.map(i=>({...i,href:projectHref(id,i.href)}))};
  content=<><ProjectImpact key={workspace.user.id} projectId={id}/><ProjectStateCard projectId={id} enabled={state}/><ProjectDecisionTimeline key={id} projectId={id}/><EpisodeCheckpointCard projectId={id} enabled={enabled("PROJECT_EPISODES_ENABLED")} reminderEnabled={reminders}/><details className={styles.secondary}><summary>项目体检与统计</summary><ProjectHealthCard projectId={id} enabled={enabled("PROJECT_HEALTH_ENABLED",true)} stateEnabled={state}/>{workspace.project.scenario==="COMPETITION"&&<CompetitionReadiness readiness={readiness}/>}<AgentMetrics metrics={metrics}/></details></>;
 }
 return <><header className={styles.pageTitle}><h2>{item.label}</h2><p>{item.description}</p></header><div className={styles.sectionStack}>{content}</div></>;
}
