import Link from "next/link";
import type {ReactNode} from "react";
import {ArrowLeft,MessageCircle,Plus} from "lucide-react";
import {ProjectSettings} from "@/components/ProjectSettings";
import {ProjectNavigation} from "@/components/ProjectNavigation";
import {loadWorkspaceProject} from "@/lib/server/projectWorkspace";
import {isFeatureEnabled} from "@/lib/config/features";
import {getScenarioColor,scenarioOptions} from "@/lib/types";
import styles from "@/components/ProjectWorkspace.module.css";
import {ProjectConversationAccess} from "@/components/ProjectConversationAccess";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectLayout({params,children}:{params:Promise<{id:string}>;children:ReactNode}){
 const {id}=await params;const workspace=await loadWorkspaceProject(id);
 if(!workspace)return children; // Child routes preserve their own sign-in return URL.
 const {project}=workspace;
 const deadline=project.deadline?project.deadline.toLocaleDateString("zh-CN",{month:"2-digit",day:"2-digit"}):null;
 return <main id="main-content" className={styles.shell}>
  <Link className={styles.back} href="/projects"><ArrowLeft size={15} aria-hidden="true"/>项目空间</Link>
  <header className={styles.heading}><div className="min-w-0"><div className={styles.headingMeta}><span className={getScenarioColor(project.scenario)}>{scenarioOptions.find(s=>s.value===project.scenario)?.label??project.scenario}</span>{project.archivedAt&&<span>已归档</span>}{deadline&&<span className={styles.deadline}>项目截止 <time dateTime={project.deadline!.toISOString()}>{deadline}</time></span>}</div><h1>{project.title}</h1><details className={styles.projectContext}><summary>项目目标与简介</summary><p>{project.goal}</p><p>{project.description}</p></details></div>
   <div className={styles.headingActions}><Link prefetch={false} className={styles.headingSecondary+" focus-ring"} href={`/projects/${id}/records#capture-box`}><Plus size={15} aria-hidden="true"/>记录进展</Link><Link prefetch={false} className={styles.headingPrimary+" focus-ring"} href={isFeatureEnabled("FOCUS_AGENT_ENABLED",false)?"?openCopilot=1":`/projects/${id}/knowledge?openCopilot=1#memory-copilot`} scroll={false} aria-label="问忆程" aria-keyshortcuts="Control+j Meta+j"><MessageCircle size={15} aria-hidden="true"/>问忆程<kbd className={styles.kbd}>Ctrl J</kbd></Link><ProjectSettings canDelete={project.memberships.some(m=>m.role==="OWNER")} project={{id,updatedAt:project.updatedAt.toISOString(),title:project.title,description:project.description,goal:project.goal,scenario:project.scenario,deadline:project.deadline?.toISOString().slice(0,10)??"",archivedAt:project.archivedAt?.toISOString()??null}}/></div></header>
  <div className={styles.workspace}><ProjectNavigation projectId={id} missionsEnabled={workspace.missionOwner&&isFeatureEnabled("MISSION_ENABLED",false)} counts={{records:project._count.cards,actions:project._count.actions,generate:project._count.artifacts}}/><div className={styles.content}>{isFeatureEnabled("FOCUS_AGENT_ENABLED",false)&&<ProjectConversationAccess key={workspace.user.id} projectId={id}/>} {children}</div></div>
 </main>;
}
