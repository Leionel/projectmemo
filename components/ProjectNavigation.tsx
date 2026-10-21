"use client";
import Link from "next/link";
import {usePathname,useRouter} from "next/navigation";
import {useEffect} from "react";
import {LayoutDashboard,Bot,Inbox,FileText,CheckSquare,Library,Activity,FileOutput} from "lucide-react";
import {projectSections,projectSectionForHash} from "@/lib/projectNavigation";
import styles from "./ProjectWorkspace.module.css";
const icons=[LayoutDashboard,Bot,Inbox,FileText,CheckSquare,Library,Activity,FileOutput];
export function ProjectNavigation({projectId,missionsEnabled}:{projectId:string;missionsEnabled:boolean}){
 const path=usePathname(),base=`/projects/${projectId}`;
 return <nav className={styles.navigation} aria-label="项目功能导航">{projectSections.map((item,index)=>{
  if(item.key==="missions"&&!missionsEnabled)return null;
  const href=base+(item.key?`/${item.key}`:"");const Icon=icons[index];
  return <Link key={item.key} href={href} prefetch={false} aria-current={path===href?"page":undefined}><Icon size={17} aria-hidden="true"/><span>{item.label}</span></Link>;
 })}</nav>;
}
/** Old bookmarked root anchors still reach the canonical feature page. */
export function ProjectLegacyRedirect({projectId}:{projectId:string}){
 const router=useRouter();
 useEffect(()=>{const go=()=>{const section=projectSectionForHash(window.location.hash);if(section)router.replace(`/projects/${projectId}/${section}${window.location.search}${window.location.hash}`);};go();window.addEventListener("hashchange",go);return()=>window.removeEventListener("hashchange",go);},[projectId,router]);
 return null;
}
