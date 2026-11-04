"use client";
import {focusPrimary} from "@/lib/client/focusPresentation";
import { useEffect, useRef, useState } from "react";
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
  const today = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "short" });
  const listGroups = visibleGroups.filter(g => g.title !== "下一步行动");
  const listEmpty = !listGroups.some(g => g.items.length > 0 || g.stopped.length > 0);
  const stoppedAll = listGroups.flatMap(g => g.stopped.map(item => ({ item, kind: g.kind })));
  const actions = focus.actions.filter(item => item.id !== hero?.id || item.projectId !== hero?.projectId).slice(0, 4);
  const failed = (item: FocusEntry) => item.workState?.phase === "FAILED" || item.status === "FAILED";
  function rowChip(item: FocusEntry, kind: string, title: string) {
    if (item.workState) return <WorkStateBadges state={item.workState}/>;
    if (kind === "INTERVENTION") return <span className={styles.chip} data-tone="risk">需要关注</span>;
    return <span className={styles.chip} data-tone={title === "需要你判断" ? "user" : "agent"}>{missionStatusLabels[item.status] ?? title}</span>;
  }
  return <div className={styles.root}>
    <div className={styles.mobileSwitch} aria-label="焦点视图">{[["focus", "项目焦点"], ["chat", "与忆程协作"]].map(([key, title]) => <button type="button" key={key} aria-pressed={mobileView === key} className={mobileView === key ? styles.active : ""} onClick={() => setMobileView(key)}>{title}</button>)}</div>
    <div className={styles.columns} data-mobile={mobileView}>
      <aside className={styles.left} aria-label="项目焦点">
        <header className={styles.pageHead}>
          <div><p className={styles.date}>{today}</p><h1>今日项目焦点</h1></div>
          <div className={styles.headTools}><Link className="workspace-tool focus-ring" href="/projects">全部项目</Link><label className={styles.scope}><input type="checkbox" checked={focus.archived} onChange={event => router.push(event.target.checked ? "/focus?archived=1" : "/focus")}/>包含归档项目</label></div>
        </header>
        {discussions.filter(d => d.unread > 0).map(d => <Link key={d.conversationId} className={styles.banner + " focus-ring"} href={conversationHref("/focus", d.conversationId)} onClick={() => { setEntry(undefined); setSelection(undefined); setMobileView("chat"); }}>
          <span aria-hidden="true" className={styles.bannerDot}/><span className={styles.bannerText}><strong>讨论新结果</strong> · 「{d.title}」有 {d.unread} 条新回答</span><span className={styles.bannerGo}>打开 →</span></Link>)}
        {hero && heroKind && <section className={styles.hero} aria-labelledby="focus-hero-title">
          <div className={styles.heroBody}>
            <div className={styles.heroMeta}>{hero.workState ? <WorkStateBadges state={hero.workState}/> : <span className={styles.chip} data-tone={heroKind === "INTERVENTION" ? "risk" : "user"}>{missionStatusLabels[hero.status] ?? (heroKind === "INTERVENTION" ? "需要关注" : "下一步")}</span>}<Link className={styles.heroProject + " focus-ring"} href={"/projects/" + hero.projectId}>{hero.projectTitle}</Link></div>
            <h2 id="focus-hero-title">{hero.title}</h2>
            {hero.detail && <p className={styles.heroReason}>{entryDetail(hero)}</p>}
            {focus.primaryContext?.workingObjective && <p className={styles.heroObjective}>当前重点：{focus.primaryContext.workingObjective}</p>}
            {heroKind === "MISSION" && <FocusPacketSummary missionId={hero.id} version={hero.workState?.originalRef.version}/>}
            <div className={styles.heroActions}>
              <div><Link className={(primaryActionTone(hero.workState) === "solid" ? "editorial-button" : primaryActionTone(hero.workState) === "failed" ? `workspace-tool ${styles.failedAction}` : "workspace-tool") + " focus-ring"} href={href(hero,heroKind)}>{hero.actionLabel??"打开原事项"}<ArrowRight size={15} aria-hidden="true"/></Link>
                {heroKind!=="PROJECT"&&<button type="button" className={styles.textAction + " focus-ring"} onClick={() => discuss(hero,heroKind)}><MessageCircle size={15} aria-hidden="true"/>和忆程讨论</button>}</div>
              {hero.workState && nextActorLabel(hero.workState.nextActor) && <span className={styles.actor}>下一步：<strong>{nextActorLabel(hero.workState.nextActor)}</strong></span>}
            </div>
          </div>
          {hero.workState && <div className={styles.heroFoot}><span>最近观察 {shortTime(hero.workState.observedAt) ? <time dateTime={hero.workState.observedAt!}>{shortTime(hero.workState.observedAt)}</time> : "尚无成功观察"} · 读取于 <time dateTime={hero.workState.checkedAt}>{shortTime(hero.workState.checkedAt) ?? "未记录"}</time></span><span>读取与刷新不推进观察时间</span></div>}
        </section>}
        <section aria-labelledby="focus-list-title">
          <div className={styles.listHead}><h2 id="focus-list-title">项目焦点</h2><div role="group" aria-label="筛选" className={styles.filters}>{[["all", "全部"], ["waiting", (focus.coverage?.complete===false?"当前待回应 ":"待回应 ")+focus.counts.waiting], ["running", "推进中 "+focus.counts.running]].map(([key, label]) => <button type="button" key={key} className={filter === key ? styles.active : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></div>
          <div className={styles.list}>
            {listGroups.flatMap(g => g.items.map(item => <article key={g.kind + item.id} className={styles.row}>
              {rowChip(item, g.kind, g.title)}
              <div className={styles.rowText}><h3>{item.title}</h3><span>{item.projectTitle}{item.detail ? " · " + entryDetail(item) : ""}</span></div>
              <div className={styles.rowActions}><Link className="focus-ring" href={href(item,g.kind)}>{item.actionLabel ?? (g.kind === "INTERVENTION" ? "为什么提醒我这个？" : "打开原事项")}</Link><button type="button" className={styles.iconAction + " focus-ring"} aria-label={"与忆程讨论：" + item.title} title="与忆程讨论" onClick={() => discuss(item, g.kind)}><MessageCircle size={15} aria-hidden="true"/></button></div>
            </article>))}
            {stoppedAll.length > 0 && <div className={styles.stoppedRow}><details className={styles.stoppedGroup}>
              <summary><span className={styles.chip} data-tone="paused">已暂停 · 未完成</span><span className={styles.rowText}><strong>{stoppedAll.length} 项委托执行已暂停或失败</strong><span>运行记录与原因保留，逐条查看</span></span></summary>
              <div className={styles.stoppedItems}>{stoppedAll.map(({ item, kind }) => <Link key={kind + item.id} className="focus-ring" href={href(item, kind)}><span data-failed={failed(item) ? "true" : undefined}>{failed(item) ? "这一步未完成" : "已暂停"}</span><span>{item.title}</span><span>{item.projectTitle}</span></Link>)}</div>
            </details></div>}
            {listEmpty && <div className={styles.emptyFilter} role="status"><p>{filter === "waiting" ? "目前没有等待你回应的委托。" : filter === "running" ? "目前没有等待执行或正在执行的委托。" : "目前没有更多待处理事项。"}</p>{filter !== "all" ? <button type="button" className="workspace-tool focus-ring" onClick={() => setFilter("all")}>查看全部事项</button> : !hero && <Link className="workspace-tool focus-ring" href="/projects">查看项目</Link>}</div>}
          </div>
          {(focus.hasMore||focus.coverage?.complete===false) && <p className={styles.footnote}>每类最多列出 6 项，计数覆盖当前授权范围。<Link className="focus-ring" href="/projects">查看全部项目 →</Link></p>}
        </section>
        <div className={styles.lower}>
          <section aria-labelledby="focus-actions-title"><div className={styles.lowerHead}><h2 id="focus-actions-title">下一步行动</h2><Link className="focus-ring" href="/actions">行动板 →</Link></div>
            <ul className={styles.compact}>{actions.map(item => <li key={item.id}><span data-doing={item.status === "DOING" ? "true" : undefined}>{item.status === "DOING" ? "进行中" : "待开始"}</span><Link className="focus-ring" href={href(item, "ACTION")}>{item.title}</Link>{item.dueAt && <time dateTime={item.dueAt}>{new Date(item.dueAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time>}</li>)}{!actions.length && <li className={styles.compactEmpty}>暂无待办行动</li>}</ul></section>
          <section aria-labelledby="focus-records-title"><div className={styles.lowerHead}><h2 id="focus-records-title">最近保存的资料</h2><Link className="focus-ring" href="/memory">检索全部记忆 →</Link></div>
            <ul className={styles.compact}>{focus.records.map(item => <li key={item.id}><span>{item.recordFields.length ? "实验记录" : "项目记录"}</span><Link className="focus-ring" href={`/projects/${item.projectId}/knowledge#card-${item.id}`}>{item.title}</Link>{item.recordedAt && <time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" })}</time>}</li>)}{!focus.records.length && <li className={styles.compactEmpty}>暂无新保存的资料</li>}</ul></section>
        </div>
      </aside>
      <aside id="focus-conversation" aria-label="与忆程协作" className={styles.right}>{syncing ? <p role="status" className={styles.calm}>正在读取讨论…</p> : <ConversationPanel entry={entry} selection={selection} onUpdated={() => router.refresh()}/>}</aside>
    </div>
  </div>;
}
