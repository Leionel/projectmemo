"use client";
import {focusPrimary} from "@/lib/client/focusPresentation";
import { Fragment, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, MessageCircle, CircleAlert, Layers3, CheckSquare2 } from "lucide-react";
import { ConversationPanel } from "./ConversationPanel";
import type { GlobalFocus, FocusEntry } from "@/lib/types/globalFocus";
import type { ConversationEntry } from "@/lib/types/conversation";
import { missionStatusLabels } from "@/lib/mission/presentation";
import { conversationHref } from "@/lib/conversation/navigation";
import { WorkStateBadges } from "./WorkStateBadges";
import { FocusPacketSummary } from "./FocusPacketSummary";
import { nextActorLabel, primaryActionTone } from "@/lib/client/workStateBadge";
import styles from "./FocusAgentWorkspace.module.css";
type DiscussionUnread = { conversationId: string; title: string; unread: number };
const shortTime = (value: string | null | undefined) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : null;
};
/** 暂停/失败是运行状态而非用户判断：列表层归并为一行摘要，逐条记录保留在展开区。 */
const isStopped = (item: FocusEntry) => item.workState ? ["PAUSED", "FAILED"].includes(item.workState.phase) : ["PAUSED", "FAILED"].includes(item.status);
type WorkspaceSyncReply = { enabled: boolean; projected: number; discussions: DiscussionUnread[] };
export function FocusAgentWorkspace({ focus }: { focus: GlobalFocus }) {
  const query = useSearchParams(), router = useRouter();
  const [entry, setEntry] = useState<ConversationEntry | undefined>(() => {
    const kind = query.get("entryKind"), id = query.get("entryId"), projectId = query.get("entryProject");
    return id && projectId && ["INTERVENTION", "GOAL_QUESTION", "IMPACT"].includes(kind ?? "") ? { kind: kind as ConversationEntry["kind"], id, projectId } : undefined;
  });
  const [selection, setSelection] = useState<{ projectId: string; title: string; id: string; kind: "MISSION" | "ACTION" }|undefined>(()=>{const kind=query.get("entryKind"),id=query.get("entryId"),projectId=query.get("entryProject");return id&&projectId&&(kind==="MISSION"||kind==="ACTION")?{kind,id,projectId,title:"原任务"}:undefined;});
  const [mobileView, setMobileView] = useState(query.get("conversation")||query.get("entryId")?"chat":"focus"), [filter, setFilter] = useState("all");
  const [syncing, setSyncing] = useState(true);
  const [synced, setSynced] = useState<{ source: GlobalFocus; discussions: DiscussionUnread[] } | null>(null);
  const syncRequest = useRef<Promise<WorkspaceSyncReply> | null>(null);
  const mountFocus = useRef(focus);
  useEffect(() => {
    let live = true;
    syncRequest.current ??= fetch("/api/conversations/sync", { method: "POST", cache: "no-store" }).then(async response => {
      if (!response.ok) throw new Error("讨论新结果暂不可读");
      return await response.json() as WorkspaceSyncReply;
    });
    void syncRequest.current.then(reply => { if (live) setSynced({ source: mountFocus.current, discussions: reply.discussions }); })
      .catch(() => { /* Keep the server-provided inbox and allow discussion to open. */ })
      .finally(() => { if (live) setSyncing(false); });
    return () => { live = false; };
  }, []);
  const discussions = Array.from(new Map([...(focus.discussions ?? []), ...(synced?.source === focus ? synced.discussions : [])]
    .map(d => [d.conversationId, d])).values());
  const groups = [
    { title: "需要你判断", kind: "MISSION" as const, items: focus.waiting.filter(x=>x.workState?x.workState.requiresUser:["WAITING_INPUT","WAITING_APPROVAL"].includes(x.status)), Icon: CircleAlert },
    { title: "主动提醒", kind: "INTERVENTION" as const, items: focus.reminders, Icon: CircleAlert },
    { title: "正在接续", kind: "MISSION" as const, items: focus.running, Icon: Layers3 },
    {title:"等待条件与已暂停",kind:"MISSION" as const,items:focus.waiting.filter(x=>x.workState?!x.workState.requiresUser:!["WAITING_INPUT","WAITING_APPROVAL"].includes(x.status)),Icon:Layers3},
    { title: "下一步行动", kind: "ACTION" as const, items: focus.actions, Icon: CheckSquare2 },
  ];
  const hero=focusPrimary(focus);
  const heroKind=hero?.entityKind??groups.find(g=>g.items.some(x=>x.id===hero?.id&&x.projectId===hero?.projectId))?.kind;
  const visibleGroups = groups.filter(g => filter === "all" || filter === "waiting" && g.title === "需要你判断" || filter === "running" && g.title === "正在接续")
    .map(g => { const rest = g.items.filter(item => item.id !== hero?.id || item.projectId !== hero?.projectId);
      const stopped = g.kind === "MISSION" ? rest.filter(isStopped) : [];
      return { ...g, items: rest.filter(item => !stopped.includes(item)).slice(0, 3), stopped }; });
  const hasVisibleItems = visibleGroups.some(g => g.items.length > 0 || g.stopped.length > 0);
  useEffect(()=>{const refresh=()=>router.refresh();window.addEventListener("focus",refresh);const boundary=focus.primaryContext?.nextBoundary;const delay=boundary?Date.parse(boundary)-Date.now():NaN;const timer=Number.isFinite(delay)?setTimeout(refresh,Math.min(Math.max(delay+50,50),2147483647)):undefined;return()=>{window.removeEventListener("focus",refresh);clearTimeout(timer);};},[focus.primaryContext?.nextBoundary,router]);
  function discuss(item: FocusEntry, kind: "MISSION" | "ACTION" | "INTERVENTION") {
    if (kind === "INTERVENTION") { setEntry({ kind, projectId: item.projectId, id: item.id }); setSelection(undefined); }
    else setSelection({ kind, projectId: item.projectId, id: item.id, title: item.title });
    setMobileView("chat");
    requestAnimationFrame(() => document.getElementById("focus-conversation")?.scrollIntoView({ block: "nearest" }));
  }
  function href(item: FocusEntry, kind: string) { if(kind==="PROJECT")return "/projects/"+item.projectId+"/records";return "/projects/" + item.projectId + (kind === "MISSION" ? "/missions?mission=" + item.id : "/actions#" + (kind === "ACTION" ? "action-" : "intervention-") + item.id); }
  /** 失败委托在列表层只展示用户需要知道的结果，技术诊断留在原详情。 */
  function entryDetail(item: FocusEntry): string {
    if (item.status === "FAILED" && item.entityKind !== "ACTION") return "委托执行中断，进入详情查看原因与恢复方式。";
    return item.detail;
  }
  return <div className={styles.root}>
    <header className={styles.pageHead}><h1>今日项目焦点</h1><Link className="workspace-tool focus-ring" href="/projects">全部项目<ArrowRight size={14}/></Link></header>
    <div className={styles.mobileSwitch} aria-label="焦点视图">{[["focus", "项目焦点"], ["chat", "与忆程协作"]].map(([key, title]) => <button type="button" key={key} aria-pressed={mobileView === key} className={mobileView === key ? styles.active : ""} onClick={() => setMobileView(key)}>{title}</button>)}</div>
    <div className={styles.columns} data-mobile={mobileView}>
      <aside className={styles.left} aria-label="项目焦点">
        {discussions.some(d => d.unread > 0) && <section className={styles.taskList} aria-label="讨论新结果"><header><h2>讨论新结果</h2></header>
          {discussions.filter(d => d.unread > 0).map(d => <article className={styles.item} key={d.conversationId}><span className={styles.itemIcon}><MessageCircle size={16}/></span><div><h3><Link className="focus-ring" href={conversationHref("/focus", d.conversationId)} onClick={() => { setEntry(undefined); setSelection(undefined); setMobileView("chat"); }}>{d.title}</Link></h3><p className={styles.excerpt}>{d.unread} 条未读</p></div></article>)}
        </section>}
        {hero && heroKind && <section className={styles.hero}><div className={styles.heroMeta}>{hero.workState ? <WorkStateBadges state={hero.workState}/> : <span className={styles.heroPill}>{missionStatusLabels[hero.status] ?? (heroKind === "INTERVENTION" ? "需要关注" : "下一步")}</span>}<span className={styles.heroProject}>{hero.projectTitle}</span></div><h2>{hero.title}</h2>{focus.primaryContext?.workingObjective&&<p>当前重点：{focus.primaryContext.workingObjective}</p>}{hero.detail && <p>{entryDetail(hero)}</p>}
          {hero.workState && <p className={styles.heroFacts}>{nextActorLabel(hero.workState.nextActor) && <span>下一步：<strong>{nextActorLabel(hero.workState.nextActor)}</strong></span>}<span>最近观察 {shortTime(hero.workState.observedAt) ? <time dateTime={hero.workState.observedAt!}>{shortTime(hero.workState.observedAt)}</time> : "尚无成功观察"}</span><span>读取于 <time dateTime={hero.workState.checkedAt}>{shortTime(hero.workState.checkedAt) ?? "未记录"}</time></span></p>}
          {heroKind === "MISSION" && <FocusPacketSummary missionId={hero.id} version={hero.workState?.originalRef.version}/>}
          <div className={styles.heroActions}><Link className={(primaryActionTone(hero.workState) === "solid" ? "editorial-button" : primaryActionTone(hero.workState) === "failed" ? `workspace-tool ${styles.failedAction}` : "workspace-tool") + " focus-ring"} href={href(hero,heroKind)}>{hero.actionLabel??"打开原事项"}<ArrowRight size={13}/></Link>{heroKind!=="PROJECT"&&<button type="button" className="workspace-tool focus-ring" onClick={() => discuss(hero,heroKind)}><MessageCircle size={14}/>和忆程讨论</button>}</div></section>}
        <section className={styles.taskList}><header><h2>项目焦点</h2><div className={styles.filters}>{[["all", "全部"], ["waiting", (focus.coverage?.complete===false?"当前待回应 ":"待回应 ")+focus.counts.waiting], ["running", "推进中 "+focus.counts.running]].map(([key, label]) => <button type="button" key={key} className={filter === key ? styles.active : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></header>
          {visibleGroups.map(g => { const row = (item: FocusEntry) => <article key={g.kind + item.id} className={styles.item}><span className={g.title === "需要你判断" || g.kind === "INTERVENTION" ? styles.warmIcon : styles.itemIcon}><g.Icon size={16}/></span><div><p className={styles.project}>{item.projectTitle}{item.workState ? <WorkStateBadges state={item.workState}/> : <span className={styles.projectLabel}>{g.title}</span>}</p><h3>{item.title}</h3>{item.detail && <p className={styles.excerpt}>{entryDetail(item)}</p>}<div className={styles.itemActions}><Link className={styles.discuss+" focus-ring"} href={href(item,g.kind)}>{item.actionLabel??"打开原事项"}</Link><button type="button" className={styles.discuss + " focus-ring"} onClick={() => discuss(item, g.kind)}>与忆程讨论<ArrowRight size={12}/></button></div></div></article>;
            return <Fragment key={g.title}>{g.items.map(row)}{g.stopped.length > 0 && <details className={styles.stoppedGroup}><summary>{g.stopped.length} 项委托已暂停或未完成</summary>{g.stopped.map(row)}</details>}</Fragment>; })}
          {!hasVisibleItems && <div className={styles.emptyFilter} role="status"><p>{filter === "waiting" ? "目前没有等待你回应的委托。" : filter === "running" ? "目前没有等待执行或正在执行的委托。" : "目前没有更多待处理事项。"}</p>{filter !== "all" ? <button type="button" className="workspace-tool focus-ring" onClick={() => setFilter("all")}>查看全部事项</button> : !hero && <Link className="workspace-tool focus-ring" href="/projects">查看项目</Link>}</div>}
        </section>
        {(focus.hasMore||focus.coverage?.complete===false) && <Link className={styles.more + " focus-ring"} href="/projects">当前范围建议先处理 · 查看全部项目 →</Link>}
      </aside>
      <div id="focus-conversation" className={styles.right}>{syncing ? <p role="status" className={styles.calm}>正在读取讨论…</p> : <ConversationPanel entry={entry} selection={selection} onUpdated={() => router.refresh()}/>}</div>
    </div>
  </div>;
}
