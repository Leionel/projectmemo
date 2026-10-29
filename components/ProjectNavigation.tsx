"use client";
import Link from "next/link";
import {usePathname,useRouter,useSearchParams} from "next/navigation";
import {conversationHref} from "@/lib/conversation/navigation";
import {useEffect} from "react";
import {LayoutDashboard,Bot,Inbox,FileText,CheckSquare,Library,Activity,FileOutput} from "lucide-react";
import {projectSections,projectSectionForHash} from "@/lib/projectNavigation";
import styles from "./ProjectWorkspace.module.css";
const icons=[LayoutDashboard,Bot,Inbox,FileText,CheckSquare,Library,Activity,FileOutput];
const groups=[{key:"",label:"概览",sections:["","health"],icon:LayoutDashboard},{key:"missions",label:"委托",sections:["missions"],icon:Bot},{key:"records",label:"资料",sections:["records","knowledge","meetings"],icon:Inbox},{key:"actions",label:"行动",sections:["actions"],icon:CheckSquare},{key:"generate",label:"成果",sections:["generate"],icon:FileOutput}];
export function ProjectNavigation({projectId,missionsEnabled}:{projectId:string;missionsEnabled:boolean}){
 const path=usePathname(),base=`/projects/${projectId}`;
 const search=useSearchParams(),conversation=search.get("conversation");
 const preserve=(href:string)=>conversation?conversationHref(href,conversation,search.get("originMessage")??undefined):href;
 const section=path.slice(base.length).split("/")[1]??"";
 return <div className={styles.navigationShell}><nav className={styles.navigation} aria-label="项目主要导航">{groups.filter(g=>g.key!=="missions"||missionsEnabled).map(g=>{const Icon=g.icon;return <Link key={g.key} href={preserve(base+(g.key?`/${g.key}`:""))} prefetch={false} aria-current={g.sections.includes(section)?"page":undefined}><Icon size={17} aria-hidden="true"/><span>{g.label}</span></Link>;})}</nav>
 {groups[2].sections.includes(section)&&<nav className={styles.contextNavigation} aria-label="资料功能"><Link href={preserve(`${base}/records`)} aria-current={section==="records"?"page":undefined}>记录与附件</Link><Link href={preserve(`${base}/knowledge`)} aria-current={section==="knowledge"?"page":undefined}>项目记忆与问答</Link><Link href={preserve(`${base}/meetings`)} aria-current={section==="meetings"?"page":undefined}>会议更新</Link></nav>}
 <details className={styles.directory}><summary>项目功能</summary><nav aria-label="项目功能导航">{projectSections.map((item,index)=>{
  if(item.key==="missions"&&!missionsEnabled)return null;
  const href=base+(item.key?`/${item.key}`:"");const Icon=icons[index];
  return <Link key={item.key} href={preserve(href)} prefetch={false} aria-current={path===href?"page":undefined}><Icon size={17} aria-hidden="true"/><span>{item.label}</span></Link>;
 })}</nav></details></div>;
}
/** Old bookmarked root anchors still reach the canonical feature page. */
export function ProjectLegacyRedirect({projectId}:{projectId:string}){
 const router=useRouter();
 useEffect(()=>{const go=()=>{const section=projectSectionForHash(window.location.hash);if(section)router.replace(`/projects/${projectId}/${section}${window.location.search}${window.location.hash}`);};go();window.addEventListener("hashchange",go);return()=>window.removeEventListener("hashchange",go);},[projectId,router]);
 return null;
}
