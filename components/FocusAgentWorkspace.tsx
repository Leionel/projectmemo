"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, MessageCircle, CircleAlert, Layers3, Clock3, CheckSquare2 } from "lucide-react";
import { ConversationPanel } from "./ConversationPanel";
import { FocusAgentLauncher } from "./FocusAgentLauncher";
import type { GlobalFocus, FocusEntry } from "@/lib/types/globalFocus";
import type { ConversationEntry } from "@/lib/types/conversation";
import { missionStatusLabels } from "@/lib/mission/presentation";
import { conversationHref } from "@/lib/conversation/navigation";
import styles from "./FocusAgentWorkspace.module.css";
type DiscussionUnread = { conversationId: string; title: string; unread: number };
type WorkspaceSyncReply = { enabled: boolean; projected: number; discussions: DiscussionUnread[] };
export function FocusAgentWorkspace({ focus }: { focus: GlobalFocus }) {
  const query = useSearchParams(), router = useRouter();
  const [entry, setEntry] = useState<ConversationEntry | undefined>(() => {
    const kind = query.get("entryKind"), id = query.get("entryId"), projectId = query.get("entryProject");
    return id && projectId && ["INTERVENTION", "GOAL_QUESTION", "IMPACT"].includes(kind ?? "") ? { kind: kind as ConversationEntry["kind"], id, projectId } : undefined;
  });
  const [selection, setSelection] = useState<{ projectId: string; title: string; id: string; kind: "MISSION" | "ACTION" }>();
  const [mobileView, setMobileView] = useState("chat"), [filter, setFilter] = useState("all");
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
    { title: "需要你判断", kind: "MISSION" as const, items: focus.waiting, Icon: CircleAlert },
    { title: "主动提醒", kind: "INTERVENTION" as const, items: focus.reminders, Icon: CircleAlert },
    { title: "正在接续", kind: "MISSION" as const, items: focus.running, Icon: Layers3 },
    { title: "下一步行动", kind: "ACTION" as const, items: focus.actions, Icon: CheckSquare2 },
  ];
  const hero = groups.find(g => g.items.length)?.items[0], heroKind = groups.find(g => g.items.length)?.kind;
  function discuss(item: FocusEntry, kind: "MISSION" | "ACTION" | "INTERVENTION") {
    if (kind === "INTERVENTION") { setEntry({ kind, projectId: item.projectId, id: item.id }); setSelection(undefined); }
    else setSelection({ kind, projectId: item.projectId, id: item.id, title: item.title });
    setMobileView("chat");
    requestAnimationFrame(() => document.getElementById("focus-conversation")?.scrollIntoView({ block: "nearest" }));
  }
  function href(item: FocusEntry, kind: string) { return "/projects/" + item.projectId + (kind === "MISSION" ? "/missions?mission=" + item.id : "/actions#" + (kind === "ACTION" ? "action-" : "intervention-") + item.id); }
  return <div className={styles.root}>
    {mobileView === "focus" && <FocusAgentLauncher className={styles.mobileLauncher} onOpen={() => { setMobileView("chat"); requestAnimationFrame(() => document.getElementById("focus-conversation")?.scrollIntoView({ block: "nearest" })); }}/>}
    <header className={styles.pageHead}><div><p className={styles.eyebrow}>我的工作台 / 焦点</p><h1>今日项目焦点</h1></div><Link className="workspace-tool focus-ring" href="/projects">全部项目<ArrowRight size={14}/></Link></header>
    <div className={styles.mobileSwitch} aria-label="焦点视图">{[["focus", "项目焦点"], ["chat", "与忆程协作"]].map(([key, title]) => <button type="button" key={key} aria-pressed={mobileView === key} className={mobileView === key ? styles.active : ""} onClick={() => setMobileView(key)}>{title}</button>)}</div>
    <div className={styles.columns} data-mobile={mobileView}>
      <aside className={styles.left} aria-label="项目焦点">
        {discussions.some(d => d.unread > 0) && <section className={styles.taskList} aria-label="讨论新结果"><header><h2>讨论新结果</h2></header>
          {discussions.filter(d => d.unread > 0).map(d => <article className={styles.item} key={d.conversationId}><span className={styles.itemIcon}><MessageCircle size={16}/></span><div><h3><Link className="focus-ring" href={conversationHref("/focus", d.conversationId)} onClick={() => { setEntry(undefined); setSelection(undefined); setMobileView("chat"); }}>{d.title}</Link></h3><p className={styles.excerpt}>{d.unread} 条未读</p></div></article>)}
        </section>}
        {hero && heroKind && <section className={styles.hero}><div className={styles.heroMeta}><span>{missionStatusLabels[hero.status] ?? (heroKind === "INTERVENTION" ? "需要关注" : "下一步")}</span><span>{hero.projectTitle}</span></div><h2>{hero.title}</h2>{hero.detail && <p>{hero.detail}</p>}<div className={styles.heroActions}><button type="button" className="editorial-button focus-ring" onClick={() => discuss(hero, heroKind)}><MessageCircle size={14}/>和忆程讨论</button><Link className="workspace-tool focus-ring" href={href(hero, heroKind)}>查看原始依据<ArrowRight size={13}/></Link></div></section>}
        <div className={styles.metrics}>{[
          { title: "需要回应", value: focus.counts.waiting, Icon: CheckSquare2 },
          { title: "主动提醒", value: focus.counts.reminders, Icon: CircleAlert },
          { title: "正在接续", value: focus.counts.running, Icon: Clock3 },
        ].map(m => <div key={m.title}><p><m.Icon size={13}/>{m.title}</p><strong>{m.value}</strong></div>)}</div>
        <section className={styles.taskList}><header><h2>项目焦点</h2><div className={styles.filters}>{[["all", "全部"], ["waiting", "待回应"], ["running", "推进中"]].map(([key, label]) => <button type="button" key={key} className={filter === key ? styles.active : ""} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div></header>
          {groups.filter(g => filter === "all" || filter === "waiting" && g.title !== "正在接续" || filter === "running" && g.title === "正在接续").map(g => g.items.slice(0, 3).map(item => <article key={g.kind + item.id} className={styles.item}><span className={g.title === "需要你判断" || g.kind === "INTERVENTION" ? styles.warmIcon : styles.itemIcon}><g.Icon size={16}/></span><div><p className={styles.project}>{item.projectTitle}<span>{g.title}</span></p><h3>{item.title}</h3>{item.detail && <p className={styles.excerpt}>{item.detail}</p>}<button type="button" className={styles.discuss + " focus-ring"} onClick={() => discuss(item, g.kind)}>与忆程讨论<ArrowRight size={12}/></button></div></article>))}
          {!groups.some(g => g.items.length) && <p className={styles.calm}>暂时没有待回应的事。从一个项目开始，和忆程讨论下一步。</p>}
        </section>
        {focus.hasMore && <Link className={styles.more + " focus-ring"} href="/projects">进入项目查看全部事项 →</Link>}
      </aside>
      <div id="focus-conversation" className={styles.right}>{syncing ? <p role="status" className={styles.calm}>正在读取讨论…</p> : <ConversationPanel entry={entry} selection={selection} onUpdated={() => router.refresh()}/>}</div>
    </div>
  </div>;
}
