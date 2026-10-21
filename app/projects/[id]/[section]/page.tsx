import Link from "next/link";
import {notFound} from "next/navigation";
import {requireWorkspaceProject,loadWorkspaceOverview} from "@/lib/server/projectWorkspace";
import {getProjectDetail} from "@/lib/repositories/projects";
import {getDecisionTimeline} from "@/lib/services/temporalLedgerService";
import {isFeatureEnabled} from "@/lib/config/features";
import {projectSections,projectHref} from "@/lib/projectNavigation";
import {MissionPanel} from "@/components/MissionPanel";
import {CaptureBox} from "@/components/CaptureBox";
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
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectFeaturePage({params,searchParams}:{params:Promise<{id:string;section:string}>;searchParams:Promise<{mission?:string}>}){
 const {id,section}=await params;
 const item=projectSections.find(p=>p.key===section&&p.key!=="generate");if(!item)notFound();
 const workspace=await requireWorkspaceProject(id,section);
 if(section==="missions"&&!workspace.missionOwner)notFound();
 const enabled=(name:string,fallback=false)=>isFeatureEnabled(name,fallback),state=enabled("PROJECT_STATE_ENABLED"),reminders=enabled("PROJECT_CALENDAR_REMINDER_ENABLED");
 let content;
 if(section==="missions")content=enabled("MISSION_ENABLED")?<MissionPanel projectId={id} initialMissionId={(await searchParams).mission}/>:<p className={styles.empty}>长期委托当前未开启。已有委托数据仍保留。</p>;
 else if(section==="records")content=<><CaptureBox projectId={id} inboxEnabled={enabled("PROJECT_INBOX_ENABLED",true)}/><Link className="focus-ring editorial-button-secondary justify-self-start" href={`/projects/${id}/knowledge`}>查看已生成的知识资产</Link></>;
 else if(section==="meetings")content=<MeetingImportCard projectId={id} stateEnabled={state}/>;
 else if(section==="actions"){
  const data=await loadWorkspaceOverview(id);
  content=<><ActionBoard projectId={id} initialActions={data.actions} reminderEnabled={reminders}/><InterventionPanel projectId={id} initialInterventions={data.interventions} demoEnabled={process.env.DEMO_SCENARIOS!=="false"}/><SchedulePlanner projectId={id} enabled={enabled("PROJECT_SCHEDULING_ENABLED")}/></>;
 }else if(section==="knowledge"){
  const [project,timeline]=await Promise.all([getProjectDetail(id),getDecisionTimeline(id)]);const byId=new Map(timeline.items.map(i=>[i.card.id,i]));
  const cards=project.cards.map(card=>{const temporal=byId.get(card.id);return {...card,temporal:temporal?{topLevelState:temporal.topLevelState,reasonCode:temporal.reasonCode,displayReason:temporal.displayReason,evidenceRefs:temporal.evidenceRefs}:undefined};});
  content=<><MemoryCopilot projectId={id}/><KnowledgeFeed projectId={id} cards={cards}/><ArchivedMemoryList projectId={id}/><MemoryConsolidationCard projectId={id} enabled={enabled("PROJECT_MEMORY_CONSOLIDATION_ENABLED")}/></>;
 }else if(section==="health"){
  const {dashboard,metrics}=await loadWorkspaceOverview(id);
  const readiness={...dashboard.readiness,items:dashboard.readiness.items.map(i=>({...i,href:projectHref(id,i.href)}))};
  content=<><ProjectHealthCard projectId={id} enabled={enabled("PROJECT_HEALTH_ENABLED",true)} stateEnabled={state}/><ProjectStateCard projectId={id} enabled={state}/><EpisodeCheckpointCard projectId={id} enabled={enabled("PROJECT_EPISODES_ENABLED")} reminderEnabled={reminders}/><CompetitionReadiness readiness={readiness}/><AgentMetrics metrics={metrics}/></>;
 }
 return <><header className={styles.pageTitle}><h2>{item.label}</h2><p>{item.description}</p></header><div className={styles.sectionStack}>{content}</div></>;
}
