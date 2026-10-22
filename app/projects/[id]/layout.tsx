import Link from "next/link";
import type {ReactNode} from "react";
import {ArrowLeft} from "lucide-react";
import {ProjectSettings} from "@/components/ProjectSettings";
import {ProjectNavigation} from "@/components/ProjectNavigation";
import {loadWorkspaceProject} from "@/lib/server/projectWorkspace";
import {isFeatureEnabled} from "@/lib/config/features";
import {scenarioOptions} from "@/lib/types";
import styles from "@/components/ProjectWorkspace.module.css";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export default async function ProjectLayout({params,children}:{params:Promise<{id:string}>;children:ReactNode}){
 const {id}=await params;const workspace=await loadWorkspaceProject(id);
 if(!workspace)return children; // Child routes preserve their own sign-in return URL.
 const {project}=workspace;
 return <main id="main-content" className={styles.shell}>
  <Link className={styles.back} href="/projects"><ArrowLeft size={15}/>返回项目列表</Link>
  <header className={styles.heading}><div className="min-w-0"><div className={styles.headingMeta}><span>{scenarioOptions.find(s=>s.value===project.scenario)?.label??project.scenario}</span>{project.archivedAt&&<span>已归档</span>}<span>更新于 {project.updatedAt.toLocaleDateString("zh-CN")}</span></div><h1>{project.title}</h1><details className={styles.projectContext}><summary>项目目标与简介</summary><p>项目名称：{project.title}</p><p>{project.goal}</p><p>{project.description}</p></details></div><div className={styles.headingActions}><ProjectSettings project={{id,title:project.title,description:project.description,goal:project.goal,scenario:project.scenario,deadline:project.deadline?.toISOString().slice(0,10)??"",archivedAt:project.archivedAt?.toISOString()??null}}/></div></header>
  <div className={styles.workspace}><ProjectNavigation projectId={id} missionsEnabled={workspace.missionOwner&&isFeatureEnabled("MISSION_ENABLED",false)}/><div className={styles.content}>{children}</div></div>
 </main>;
}
