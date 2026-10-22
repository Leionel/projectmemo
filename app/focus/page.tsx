import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ArrowUpRight, Bot, CalendarDays, CircleHelp, Clock3, Inbox, Layers3 } from "lucide-react";
import { getSessionUser } from "@/lib/auth/serverSession";
import { loadGlobalFocus } from "@/lib/server/globalFocus";
import { getDeadlineState } from "@/lib/projectDashboard";
import { missionStatusLabels } from "@/lib/mission/presentation";
import { EvidenceText } from "@/components/EvidenceText";
import { knowledgeTypeLabels, type KnowledgeTypeValue } from "@/lib/types";
import type { FocusEntry, GlobalFocus } from "@/lib/types/globalFocus";
import styles from "@/components/FocusDashboard.module.css";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function FocusPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Ffocus");
  const focus = await loadGlobalFocus(user.id, (await searchParams).archived === "1");
  const empty = ![focus.waiting, focus.running, focus.actions, focus.reminders, focus.records].some(rows => rows.length);
  return <main id="main-content" className={`shell ${styles.page}`}>
    <header className={styles.header}><div><p className={styles.eyebrow}>我的工作台</p><h1>焦点</h1><p className={styles.intro}>先回应需要你的事，再继续正在推进的目标。</p></div>
      <div className={styles.toolbar}><form action="/focus" className={styles.scope} aria-label="焦点范围"><label><input type="checkbox" name="archived" value="1" defaultChecked={focus.archived}/><span className={styles.switch} aria-hidden="true"/><span>包含归档项目</span></label><button className="workspace-tool focus-ring">应用范围</button></form><Link prefetch={false} href="/projects" className="workspace-tool focus-ring">查看项目<ArrowUpRight size={14} aria-hidden="true"/></Link></div>
    </header>
    {!focus.missionEnabled && <p role="status" className={styles.notice}>长期委托当前未开启，已有委托数据仍保留。</p>}
    <Pulse focus={focus}/>
    {empty ? <section className={styles.empty}><Inbox size={24} aria-hidden="true"/><h2>从一个真实项目开始</h2><p>当前范围内没有待回应或推进中的事项。进入项目记录资料，或委托一个长期目标。</p><Link prefetch={false} className="editorial-button focus-ring" href="/projects">选择或创建项目<ArrowRight size={14} aria-hidden="true"/></Link></section> : <>
      <div className={styles.stage}><div className={styles.missions}>
        <MissionGroup title="需要回应的委托" items={focus.waiting} waiting/>
        <MissionGroup title="正在推进的委托" items={focus.running}/>
        <Actions items={focus.actions}/>
        {!focus.waiting.length && !focus.running.length && focus.missionEnabled && <section className={styles.calm}><Bot size={20} aria-hidden="true"/><h2>当前没有待接续的委托</h2><p>你可以继续已有行动，或进入项目委托一个新目标。</p><Link prefetch={false} href="/projects" className="workspace-link focus-ring">选择项目<ArrowRight size={14} aria-hidden="true"/></Link></section>}
      </div><Reminders items={focus.reminders}/></div>
      <Records items={focus.records}/>
    </>}
    {focus.hasMore && <p className={styles.footnote}>正文每类最多列出 6 项，顶部计数覆盖当前授权范围。<Link prefetch={false} href="/projects" className="workspace-link focus-ring">进入所属项目查看全部 →</Link></p>}
  </main>;
}
function Pulse({focus}:{focus:GlobalFocus}) {
  const cells = [
    {value:focus.counts.waiting, label:"需要回应的委托", detail:"补充、审批、暂停或失败", href:"#focus-waiting", icon:CircleHelp, amber:true},
    {value:focus.counts.running, label:"等待执行 / 执行中的委托", detail:"查看真实状态与保存的活动", href:"#focus-running", icon:Bot, amber:false},
    {value:focus.counts.reminders, label:"有效提醒", detail:"核对依据后在原项目处理", href:"#focus-reminders", icon:Layers3, amber:false},
    {value:focus.counts.actions, label:"未完成行动", detail:"行动结果仍需实际记录", href:"#focus-actions", icon:Clock3, amber:false},
  ].filter(cell=>cell.value>0).slice(0,4);
  const deadline=focus.nextDeadline?getDeadlineState(focus.nextDeadline.at):null;
  if(!cells.length&&!deadline)return null;
  return <section className={styles.pulse} aria-label="当前范围概览">{cells.map(cell=><a key={cell.href} href={cell.href} className={`${styles.pulseCell} ${cell.amber?styles.amberCell:""} focus-ring`}><span className={styles.pulseLabel}><cell.icon size={14} aria-hidden="true"/>{cell.label}</span><strong>{cell.value}<small>项</small></strong><span className={styles.pulseDetail}>{cell.detail}</span></a>)}{deadline&&focus.nextDeadline&&cells.length<4&&<Link prefetch={false} href={`/projects/${focus.nextDeadline.projectId}/actions`} className={`${styles.pulseCell} focus-ring`}><span className={styles.pulseLabel}><CalendarDays size={14} aria-hidden="true"/>最近项目截止</span><strong className={styles.deadlineValue}>{deadline.label}</strong><span className={styles.pulseDetail}>{focus.nextDeadline.projectTitle}</span></Link>}</section>;
}
function PanelHeading({title,items}:{title:string;items:FocusEntry[]}) { return <div className={styles.panelHeading}><h2>{title}</h2><span>本次列出 {items.length} 项</span></div>; }
function MissionRow({item,waiting}:{item:FocusEntry;waiting:boolean}) {
  const question=item.status==="WAITING_INPUT", approval=item.status==="WAITING_APPROVAL";
  const label=question?"补充委托资料":approval?"审阅待批准提案":item.status==="PAUSED"?"查看暂停原因":item.status==="FAILED"?"查看失败原因":"查看委托进展";
  return <article className={styles.missionRow}><div className={styles.rowBody}><div className={styles.meta}><span className={waiting?"workspace-status":"workspace-status workspace-status-neutral"}>{missionStatusLabels[item.status]}</span><Link prefetch={false} className="focus-ring" href={`/projects/${item.projectId}`}>{item.projectTitle}</Link></div><h3>{item.title}</h3>{item.detail&&<blockquote className={styles.question}><span>{question?"忆程追问":approval?"待审阅提案":"当前原因"}</span><p>{item.detail}</p></blockquote>}{item.activity&&<p className={styles.activity}>{item.activity}{item.activityAt&&<> · <time dateTime={item.activityAt}>{new Date(item.activityAt).toLocaleString("zh-CN")}</time></>}</p>}</div><Link prefetch={false} className={`${question||approval?"editorial-button":"workspace-link"} ${styles.rowAction} focus-ring`} href={`/projects/${item.projectId}/missions?mission=${encodeURIComponent(item.id)}`}>{label}<ArrowRight size={14} aria-hidden="true"/></Link></article>;
}
function MissionGroup({title,items,waiting=false}:{title:string;items:FocusEntry[];waiting?:boolean}) {
  if(!items.length)return null;
  return <section id={waiting?"focus-waiting":"focus-running"} className={`${styles.panel} ${waiting?styles.handover:""}`} aria-label={title}><PanelHeading title={title} items={items}/>{items.slice(0,3).map(item=><MissionRow key={item.id} item={item} waiting={waiting}/>)}{items.length>3&&<details className={styles.more}><summary className="focus-ring">展开其余 {items.length-3} 项委托</summary>{items.slice(3).map(item=><MissionRow key={item.id} item={item} waiting={waiting}/>)}</details>}</section>;
}
function ReminderText({text}:{text:string}) {
  return <>{text.split(/(paper_note|code_issue|experiment_log|meeting_note|requirement|reflection)/g).map((part,i)=>i%2?<code title={`原记录字段：${part}`} key={i}>{knowledgeTypeLabels[part as KnowledgeTypeValue]}</code>:part)}</>;
}
function Reminders({items}:{items:FocusEntry[]}) {
  if(!items.length)return null;
  const groups=new Map<string,FocusEntry[]>();for(const item of items)groups.set(item.projectId,[...(groups.get(item.projectId)??[]),item]);
  const row=(item:FocusEntry)=><article key={item.id} className={styles.reminderRow}><div><h3>{item.title}</h3><p><ReminderText text={item.detail}/></p></div><Link prefetch={false} href={`/projects/${item.projectId}/actions#intervention-${item.id}`} className="workspace-link focus-ring">查看提醒依据<ArrowRight size={13} aria-hidden="true"/></Link></article>;
  return <aside id="focus-reminders" className={styles.panel} aria-label="有效提醒"><PanelHeading title="有效提醒" items={items}/>{[...groups.entries()].map(([id,group])=>{const deadline=group[0].projectDeadline?getDeadlineState(group[0].projectDeadline):null;return <section key={id} className={styles.projectGroup}><header><Link prefetch={false} className="focus-ring" href={`/projects/${id}/actions#interventions`}>{group[0].projectTitle}<ArrowUpRight size={13} aria-hidden="true"/></Link>{deadline&&<span className={deadline.rank>=3?styles.urgent:styles.deadline}>{deadline.label}</span>}</header>{group.slice(0,3).map(row)}{group.length>3&&<details className={styles.more}><summary className="focus-ring">展开本项目其余 {group.length-3} 条提醒</summary>{group.slice(3).map(row)}</details>}</section>;})}</aside>;
}
function Actions({items}:{items:FocusEntry[]}) {
  if(!items.length)return null;
  return <section id="focus-actions" className={styles.panel} aria-label="需要处理的行动"><PanelHeading title="需要处理的行动" items={items}/>{items.map(item=><article key={item.id} className={styles.actionRow}><div><p className={styles.meta}>{item.projectTitle} · {item.status==="DOING"?"进行中":"待开始"}</p><h3>{item.title}</h3>{item.dueAt&&<p className={styles.activity}>截止：{new Date(item.dueAt).toLocaleDateString("zh-CN")}</p>}</div><Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${item.projectId}/actions#action-${item.id}`}>打开行动<ArrowRight size={14} aria-hidden="true"/></Link></article>)}</section>;
}
function Records({items}:{items:FocusEntry[]}) {
  if(!items.length)return null;
  return <section className={styles.records} aria-label="最近保存的资料"><div className={styles.recordsHeading}><div><h2>最近保存的资料</h2><p>保留原始记录，回到所属项目核对来源。</p></div><Link prefetch={false} className="workspace-link focus-ring" href="/memory">检索全部记忆<ArrowRight size={14} aria-hidden="true"/></Link></div><div className={styles.recordGrid}>{items.map(item=><article key={item.id} className={styles.recordCard}><div><p className={styles.recordProject}>{item.projectTitle}</p><span className={styles.recordKind}>{item.recordFields.length?"结构化记录 · 待核对":"已保存的项目记录"}</span><h3>{item.title}</h3>{item.recordFields.length?<dl>{item.recordFields.map(field=><div key={field.label}><dt>{field.label}</dt><dd>{field.value}</dd></div>)}</dl>:<p className={styles.recordExcerpt}><EvidenceText text={item.detail}/></p>}</div><footer><time dateTime={item.recordedAt}>保存于 {new Date(item.recordedAt).toLocaleString("zh-CN")}</time><Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${item.projectId}/knowledge#card-${item.id}`}>查看资料与来源<ArrowRight size={14} aria-hidden="true"/></Link></footer></article>)}</div></section>;
}
