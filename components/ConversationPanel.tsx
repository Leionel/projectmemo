"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { ConversationEntry, ConversationView, ConversationMessage } from "@/lib/types/conversation";
import { conversationHref } from "@/lib/conversation/navigation";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";
import { Sparkles, ArrowUp, Plus, CornerDownRight } from "lucide-react";
import type { ConversationWorkRef } from "@/lib/types/conversationWork";
import { ConversationWorkCard } from "./ConversationWorkCard";
import { ConversationAnchorPanel } from "./ConversationAnchorPanel";
import { ConversationFileGuides, ConversationAnswer } from "./ConversationFileGuides";
import { missionStatusLabels } from "@/lib/mission/presentation";
import styles from "./ConversationPanel.module.css";
import { AgentMessageBlocks, supportsAgentPresentation } from "./AgentMessageBlocks";
import type { AllowedAction } from "@/lib/types/agentExperience";
import { clearConversationDrafts, clearConversationDraft, readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  const value = await r.json();
  if (r.status === 401) clearConversationDrafts();
  if (!r.ok) throw Object.assign(new Error(value.error?.message ?? "讨论暂不可用"), { status: r.status, code: value.error?.code });
  return value as T;
}
type PanelProps = {
  projectId?: string; entry?: ConversationEntry; initialConversationId?: string; onUpdated?: () => void;
  selection?: { projectId: string; title: string; id: string; kind: "MISSION" | "ACTION" };
};
const statusLabel = (status?: string | null) => status ? missionStatusLabels[status] ?? ({ TODO: "待办", DOING: "进行中", DONE: "已完成" } as Record<string, string>)[status] ?? status : "回执已保存";
export function ConversationPanel(props: PanelProps) {
  const search = useSearchParams();
  const initial = props.initialConversationId ?? search.get("conversation") ?? "";
  return <ConversationContent key={[props.projectId, initial, props.entry?.kind, props.entry?.id].join(":")} {...props} initialConversationId={initial}/>;
}
function ConversationContent({ projectId, entry, initialConversationId, onUpdated, selection }: PanelProps) {
  const router = useRouter();
  const search = useSearchParams(), initial = initialConversationId ?? search.get("conversation") ?? "";
  const [view, setView] = useState<ConversationView | null>(null);
  const [list, setList] = useState<Array<{ id: string; title: string }>>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [text, setText] = useState(selection ? "请先调查“" + selection.title + "”的依据和下一步。" : ""), [busy, setBusyState] = useState(false), [error, setError] = useState("");
  const busyRef = useRef(false);
  const setBusy = useCallback((value: boolean) => { busyRef.current = value; setBusyState(value); }, []);
  const [cloud, setCloud] = useState(false), [reply, setReply] = useState<ConversationMessage | null>(null);
  const [showCloudHelp, setShowCloudHelp] = useState(false);
  const [cloudAvailable, setCloudAvailable] = useState(false), [analysisReady, setAnalysisReady] = useState(false);
  const [r4Available, setR4Available] = useState(false), [investigationMode, setInvestigationMode] = useState<"QUICK" | "STANDARD" | "DEEP">("STANDARD");
  const [target, setTarget] = useState(selection?.projectId ?? projectId ?? ""), [showPreference, setShowPreference] = useState(false);
  const [workRef, setWorkRef] = useState<ConversationWorkRef | null>(null);
  const generation = useRef(0), pending = useRef<{ text: string; id: string; body: unknown } | null>(null);
  const messageRegion = useRef<HTMLDivElement>(null);
  const createKey = useRef(crypto.randomUUID()), confirmKeys = useRef(new Map<string, string>());
  const loadedId = useRef("");
  const uiKeys = useRef(new Map<string, { requestId: string; version: number }>());
  useEffect(() => {
    let live = true;
    void api<{ cloudAvailable: boolean; r4Available?: boolean }>("/api/conversations/capabilities").then(caps => {
      if (live) { setCloudAvailable(caps.cloudAvailable); setCloud(caps.cloudAvailable); setR4Available(caps.r4Available === true); setAnalysisReady(true); }
    }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, []);
  const [previousSelection, setPreviousSelection] = useState(selection);
  if (selection && selection !== previousSelection) {
    setPreviousSelection(selection);
    setTarget(selection.projectId); setText("请先调查“" + selection.title + "”的依据和下一步。");
  }
  const load = useCallback(async (id: string, epoch: number) => {
    const v = await api<ConversationView>("/api/conversations/" + id);
    if (epoch === generation.current) {
      setView(v);
      if (loadedId.current !== id) {
        if (!selection) setText(readConversationDraft(id + ":composer").answer);
        setTarget(selection?.projectId ?? v.focusProjectId ?? projectId ?? ""); loadedId.current = id;
        requestAnimationFrame(() => { if (epoch === generation.current && messageRegion.current) messageRegion.current.scrollTop = messageRegion.current.scrollHeight; });
      }
    }
  }, [projectId, selection]);
  useEffect(() => { if (view) saveConversationDraft(view.id + ":composer", { ...readConversationDraft(view.id + ":composer"), answer: text }); }, [view, text]);
  useEffect(() => {
    if (!busy || !view) return;
    const id = view.id, epoch = generation.current;
    const timer = setInterval(() => { void load(id, epoch).catch(() => undefined); }, 1200);
    return () => clearInterval(timer);
  }, [busy, view?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const epoch = ++generation.current;
    void (async () => {
      const rows = await api<{ conversations: Array<{ id: string; title: string; scope: "WORKSPACE" | "PROJECT" }> }>("/api/conversations" + (projectId ? "?projectId=" + encodeURIComponent(projectId) : ""));
      if (epoch !== generation.current) return;
      setList(rows.conversations);
      if (entry) {
        const c = await api<{ id: string }>("/api/conversations/entry", "POST", {
          requestId: createKey.current + ":" + entry.id, scope: "WORKSPACE", entry,
        });
        await load(c.id, epoch); setText("为什么提醒我这个？");
      } else {
        const recent = projectId ? rows.conversations[0] : rows.conversations.find(c => c.scope === "WORKSPACE");
        if (initial || recent) await load(initial || recent!.id, epoch);
      }
    })().catch(e => { if (epoch === generation.current) { setError(e.message); if ([401, 403, 404].includes(e.status)) { setView(null); setList([]); } } })
      .finally(() => { if (epoch === generation.current) setLoadingHistory(false); });
    const activeGeneration = generation;
    return () => { activeGeneration.current++; };
  }, [initial, projectId, entry, load]);
  useEffect(() => {
    if (!view) return;
    const id = view.id, epoch = generation.current;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || busyRef.current) return;
      setBusy(true);
      void load(id, epoch).catch(e => { if (epoch === generation.current && [401, 403, 404].includes(e.status)) { setView(null); setList([]); setError(e.message); } })
        .finally(() => { if (epoch === generation.current) setBusy(false); });
    }, 5000);
    return () => clearInterval(timer);
  }, [view, busy, load, setBusy]);
  async function create() {
    if (busyRef.current) return;
    const epoch = ++generation.current;
    setBusy(true); setError("");
    try {
      const c = await api<{ id: string }>("/api/conversations", "POST", {
        requestId: crypto.randomUUID(), scope: projectId ? "PROJECT" : "WORKSPACE", ...(projectId ? { projectId } : {}),
      });
      await load(c.id, epoch); setReply(null); setWorkRef(null); pending.current = null;
      if (selection && epoch === generation.current) setTarget(selection.projectId);
      const rows = await api<{ conversations: Array<{ id: string; title: string }> }>("/api/conversations" + (projectId ? "?projectId=" + encodeURIComponent(projectId) : ""));
      if (epoch === generation.current) setList(rows.conversations);
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : "创建失败"); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function ask(e: React.FormEvent) {
    e.preventDefault(); if (!view || !analysisReady || !text.trim() || busyRef.current) return;
    const epoch = generation.current, currentText = text.trim();
    const intentKey = JSON.stringify({ text: currentText, target, replyId: reply?.id, entityId: selection?.id, cloud, investigationMode });
    if (!pending.current || pending.current.text !== intentKey) pending.current = { text: intentKey, id: crypto.randomUUID(),
      body: { requestId: crypto.randomUUID(), expectedVersion: view.version, message: currentText,
        projectId: target || null, ...(reply ? { replyToMessageId: reply.id } : {}),
        ...(selection && selection.projectId === target ? { entityRef: { kind: selection.kind, id: selection.id, projectId: selection.projectId } } : {}),
        llmContextApproved: cloud && cloudAvailable, ...(r4Available ? { investigationMode } : {}) } };
    setBusy(true); setError("");
    try {
      const result = await api<{ conversation: ConversationView; status: string }>("/api/conversations/" + view.id + "/turns", "POST", pending.current.body);
      if (epoch !== generation.current) return;
      setView(result.conversation);
      setList(rows => rows.map(row => row.id === result.conversation.id ? { ...row, title: result.conversation.title } : row));
      setTarget(result.conversation.focusProjectId ?? "");
      requestAnimationFrame(() => { if (epoch === generation.current && messageRegion.current) messageRegion.current.scrollTop = messageRegion.current.scrollHeight; });
      if (["ANSWERED", "NEEDS_CLARIFICATION", "CANCELLED"].includes(result.status)) { setText(""); setReply(null); pending.current = null; }
      else { setError(""); if (["UNKNOWN", "FAILED"].includes(result.status)) pending.current = null; }
    } catch (e) {
      if (epoch !== generation.current) return;
      const err = e as Error & { code?: string; status?: number };
      setError(err.message);
      if (["CONVERSATION_CHANGED", "SOURCE_CHANGED", "MISSION_CHANGED"].includes(err.code ?? "")) pending.current = null;
      if ([401, 403, 404].includes(err.status ?? 0)) { setView(null); setList([]); pending.current = null; setText(""); }
      else {
        try { const next = await api<ConversationView>("/api/conversations/" + view.id); if (epoch === generation.current) { setView(next); if (next.latestTurn?.canRetry) { pending.current = null; setError(""); } } } catch { /* Keep the original transport error. */ }
      }
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  async function confirm(m: ConversationMessage, decline = false) {
    if (!view || !m.proposal || busyRef.current) return;
    const epoch = generation.current, p = m.proposal;
    setBusy(true); setError("");
    let key = confirmKeys.current.get(p.executionId);
    if (!key) { key = crypto.randomUUID(); confirmKeys.current.set(p.executionId, key); }
    try {
      const result = await api<{ conversation: ConversationView }>("/api/conversations/" + view.id + "/proposals/" + p.executionId + (decline ? "/decline" : "/confirm"),
        "POST", decline ? {} : { requestId: key, confirmed: true, proposalHash: p.proposalHash });
      if (epoch !== generation.current) return;
      setView(result.conversation); onUpdated?.(); emitWorkspaceChange(p.projectId, ["actions"]);
      requestAnimationFrame(() => { if (epoch === generation.current && messageRegion.current) messageRegion.current.scrollTop = messageRegion.current.scrollHeight; });
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : "确认失败，请刷新查看原结果"); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  async function uiAction(message: ConversationMessage, action: AllowedAction, answer?: string) {
    if (!view || busyRef.current) return;
    const epoch = generation.current;
    setBusy(true); setError("");
    let key = uiKeys.current.get(action.bindingId);
    if (!key) { key = { requestId: crypto.randomUUID(), version: view.version }; uiKeys.current.set(action.bindingId, key); }
    try {
      let result = await api<{ conversation: ConversationView; href?: string }>(`/api/conversations/${view.id}/ui-actions`, "POST", {
        messageId: message.id, bindingId: action.bindingId, requestId: key.requestId, expectedConversationVersion: key.version,
      });
      if (epoch !== generation.current) return;
      if (action.actionKind === "ASK" && answer?.trim()) {
        result = await api(`/api/conversations/${view.id}/turns`, "POST", { requestId: crypto.randomUUID(), expectedVersion: result.conversation.version,
          message: answer.trim(), replyToMessageId: message.id, projectId: action.target.projectId, llmContextApproved: cloud && cloudAvailable,
          ...(r4Available ? { investigationMode } : {}) });
        clearConversationDraft(`${view.id}:${action.target.id}`);
      } else if (action.actionKind === "ASK") {
        setText("请调查这条变化的依据，判断对原目标有什么影响，并给出待确认的下一步。");
        setReply(message); setTarget(action.target.projectId); pending.current = null;
      }
      if (epoch !== generation.current) return;
      setView(result.conversation); onUpdated?.(); emitWorkspaceChange(action.target.projectId, ["actions"]);
      if (action.actionKind === "PREVIEW") requestAnimationFrame(() => {
        document.getElementById("conversation-message-" + result.conversation.messages.at(-1)?.id)?.scrollIntoView({ block: "nearest" });
      });
      if (action.actionKind === "CONFIRM") requestAnimationFrame(() => {
        if (epoch === generation.current) document.getElementById("conversation-message-" + message.id)?.querySelector('[data-block="receipt"]')?.scrollIntoView({ block: "nearest" });
      });
      if (result.href) router.push(result.href);
    } catch (e) {
      if (epoch === generation.current) {
        setError(e instanceof Error ? e.message : "操作尚未完成，请读取原状态");
        // A lost confirmation response must replay the same durable request.
        if (e instanceof Error && "status" in e && e.status !== 502 && e.status !== 504) uiKeys.current.delete(action.bindingId);
        await load(view.id, epoch).catch(() => undefined);
      }
    } finally { if (epoch === generation.current) setBusy(false); }
  }
  async function older() {
    if (!view?.beforeSeq || busyRef.current) return;
    const epoch = generation.current; setBusy(true);
    try {
      const v = await api<ConversationView>("/api/conversations/" + view.id + "?beforeSeq=" + view.beforeSeq);
      if (epoch === generation.current) setView(old => old ? { ...old, messages: [...v.messages, ...old.messages], hasMore: v.hasMore, beforeSeq: v.beforeSeq } : v);
    } catch (e) { if (epoch === generation.current) setError(e instanceof Error ? e.message : "历史暂不可读"); }
    finally { if (epoch === generation.current) setBusy(false); }
  }
  return <section className={styles.panel} aria-label="问忆程">
    <header className={styles.header}><div className={styles.agentTitle}><span className={styles.agentMark} aria-hidden="true"><Sparkles size={19}/></span><div><h2>与忆程协作</h2><p>{view?.scope === "PROJECT" ? "项目讨论" : "项目记忆 · 对话与接续"}</p></div></div><div className={styles.historyControls}>
      <select aria-label="选择讨论" value={view?.id ?? ""} disabled={busy} onChange={e => {
        if (busyRef.current) return;
        const epoch = ++generation.current; setBusy(true); setReply(null); setWorkRef(null); pending.current = null;
        void load(e.target.value, epoch).catch(err => { if (epoch === generation.current) setError(err.message); })
          .finally(() => { if (epoch === generation.current) setBusy(false); });
      }}><option value="" disabled>选择讨论</option>{view && !list.some(c => c.id === view.id) && <option value={view.id}>{view.title}</option>}
        {list.map(c => <option value={c.id} key={c.id}>{c.title}</option>)}</select>
      <button type="button" aria-label="新讨论" title="新讨论" className={styles.newDiscussion + " focus-ring"} disabled={busy} onClick={() => void create()}><Plus size={17}/></button>
    </div></header>
    {view && showPreference && target && <FocusPreference key={target} projectId={target} onError={setError}/>}
    <div ref={messageRegion} className={styles.messages} aria-live="polite" aria-busy={busy}>
      {view && <ConversationAnchorPanel key={view.id} conversationId={view.id} revision={view.version} busy={busy || workRef !== null}
        acquire={() => { if (busyRef.current || workRef !== null) return false; setBusy(true); return true; }}
        release={() => { if (loadedId.current === view.id) setBusy(false); }}
        onReadResults={() => { if (loadedId.current === view.id && messageRegion.current) messageRegion.current.scrollTop = messageRegion.current.scrollHeight; }}
        onUpdated={v => { if (loadedId.current === v.id) { setView(v); onUpdated?.(); } }}/>}
      {view?.hasMore && <button type="button" className="workspace-link focus-ring" onClick={() => void older()}>读取更早讨论</button>}
      {view?.latestTurn?.canRetry && <div className={styles.reason} role="status"><strong>这次分析未完成</strong><p>{view.latestTurn.message}</p><button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => { pending.current = null; setText(view.messages.filter(m => m.role === "USER").at(-1)?.content ?? ""); }}>重新提问 →</button></div>}
      {loadingHistory && <p role="status">正在读取讨论…</p>}
      {!view && !loadingHistory && <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">忆</span><h3>从今天最重要的事开始</h3><p>忆程会带上项目记忆，和你一起往下走。</p><button className="editorial-button focus-ring" onClick={() => void create()} disabled={busy}>开始讨论</button></div>}
      {view && !view.messages.length && <div className={styles.empty}><span className={styles.emptyMark} aria-hidden="true">忆</span><h3>今天，先推进哪件事？</h3><div className={styles.starters}>{["最近哪个项目最值得先处理？", "这周有哪些待回应的事？"].map(q => <button key={q} type="button" className={styles.starter + " focus-ring"} onClick={() => setText(q)}>{q}<span aria-hidden="true">↗</span></button>)}</div></div>}
      {view?.messages.map(m => <article key={m.id} id={"conversation-message-" + m.id} className={m.role === "USER" ? styles.user : styles.assistant}>
        {m.role === "USER" && <div className={styles.userHead}><strong>你</strong><span aria-hidden="true">我</span></div>}
        {m.role === "ASSISTANT" && <div className={styles.answerHead}><span aria-hidden="true">忆</span><strong>忆程</strong><small>{m.provider === "rules" ? "规则观察" : m.provider === "project_state" ? "项目记录" : "基于本次授权资料"}</small></div>}
        {supportsAgentPresentation(m) ? <AgentMessageBlocks message={m} conversationId={view.id} busy={busy} onAction={(action, answer) => uiAction(m, action, answer)}/>
          : <p className={styles.body}><ConversationAnswer message={m} conversationId={view.id}/></p>}
        <ConversationFileGuides message={m} conversationId={view.id}/>
        {!supportsAgentPresentation(m) && !!m.priorities.length && <details><summary>优先级依据与取舍</summary>{m.priorities.map(p => <div key={p.projectId} className={styles.reason}>
          <strong>{view.linkedProjects.find(v => v.id === p.projectId)?.title ?? "项目"}</strong>
          <p>{p.importance}；{p.urgency}；{p.blocking}；{p.effort}</p><p>{p.preference}</p><p>{p.tradeoff}</p>
        </div>)}</details>}
        {!supportsAgentPresentation(m) && !!m.sources.length && <details><summary>来源与观察范围（{m.sources.length}）</summary>{m.sources.map(s => <blockquote key={s.id}>
          <p>{s.title}</p><p>{s.excerpt}</p><small>{s.temporalState} · {new Date(s.observedAt).toLocaleString("zh-CN")}</small>
        </blockquote>)}{m.limitations.map((l, i) => <p key={i}>{l}</p>)}</details>}
        <div className={styles.refs}>{m.refs.filter(r => r.kind === "PROJECT" || r.kind === "MISSION").slice(0, 3).map(r => <div key={r.bindingId ?? r.id}>
          <button type="button" className={styles.contextChip + " focus-ring"} disabled={busy} onClick={() => {
            setTarget(r.projectId); setReply(m); setText("帮我先处理这个项目最重要的待办。"); pending.current = null;
          }}>{r.title}</button>
          <Link className={styles.quietLink + " focus-ring"} href={conversationHref(r.href, view.id, m.id)}>查看{r.kind === "MISSION" ? "委托" : "项目"} ↗</Link>
          {["MISSION", "ACTION"].includes(r.kind) && <button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => setWorkRef({ kind: r.kind as "MISSION" | "ACTION", id: r.id, projectId: r.projectId })}>在此协作</button>}
          {r.kind === "MISSION" && r.status === "PAUSED" && <button type="button" className="workspace-link focus-ring" disabled={busy} onClick={() => {
            if (busyRef.current) return;
            const epoch = generation.current; setBusy(true);
            void api<{conversation:ConversationView}>("/api/conversations/" + view.id + "/missions/" + r.id + "/resume-preview", "POST", {})
              .then(v => { if (epoch === generation.current) setView(v.conversation); }).catch(e => setError(e.message))
              .finally(() => { if (epoch === generation.current) setBusy(false); });
          }}>预览接续原委托</button>}
        </div>)}</div>
        {m.proposal && !(supportsAgentPresentation(m) && m.presentation!.blocks.some(b => ["approval", "receipt"].includes(b.semanticType))) && <section className={styles.proposal} aria-label="行动提案">
          <div className={styles.proposalMeta}><span>{m.proposal.resultId ? "已写入原项目" : "待你确认"}</span><span>{view.linkedProjects.find(v => v.id === m.proposal?.projectId)?.title}</span></div>
          <strong>{m.proposal.title}</strong><p>{m.proposal.description}</p>
          {m.proposal.resultId ? <p>{!m.proposal.tool || m.proposal.tool === "create_action" ? "已创建行动" : "已提交原操作"} · {statusLabel(m.proposal.actionStatus)} <Link className="workspace-link focus-ring" href={conversationHref("/projects/" + m.proposal.projectId + (m.proposal.tool === "adopt_artifact" ? "/artifacts" : !m.proposal.tool || ["create_action", "complete_action"].includes(m.proposal.tool) ? "/actions#action-" + m.proposal.resultId : "/missions?mission=" + m.proposal.resultId), view.id, m.id)}>查看原结果</Link>{(!m.proposal.tool || ["create_action", "complete_action"].includes(m.proposal.tool)) && <button className="workspace-link focus-ring" onClick={() => setWorkRef({ kind: "ACTION", id: m.proposal!.resultId!, projectId: m.proposal!.projectId })}>记录与查看结果</button>}{m.proposal.resultCardId && <span className={styles.receipt}>复盘已保存 · {m.proposal.resultCardId}</span>}</p>
            : m.proposal.status === "PENDING" ? <div className={styles.actions}><button className="editorial-button focus-ring" disabled={busy} onClick={() => void confirm(m)}>{m.proposal.tool === "resume_mission" ? "确认接续原委托" : !m.proposal.tool || m.proposal.tool === "create_action" ? "确认创建行动" : "确认此操作"}</button>
              <button className="workspace-tool focus-ring" disabled={busy} onClick={() => void confirm(m, true)}>不采用</button></div> : <p>{m.proposal.status === "DECLINED" ? "已不采用" : m.proposal.status}</p>}
        </section>}
        {m.role === "ASSISTANT" && !m.restricted && <button className={styles.followup + " focus-ring"} onClick={() => setReply(m)}><CornerDownRight size={12}/>追问</button>}
      </article>)}
      {view && workRef && <ConversationWorkCard key={view.id + workRef.kind + workRef.id} conversation={view} workRef={workRef} onChange={v => { setView(v); onUpdated?.(); }} onClose={() => setWorkRef(null)}/>}
      {busy && <div className={styles.liveProgress} role="status"><strong>{({ ROUTING: "正在定位相关项目", READING_SOURCE: "正在读取原资料", EVALUATING: "正在判断目标差距", WAITING_MODEL: "正在整理结论", READY: "正在保存本轮回答", WAITING_USER: "正在整理需要你补充的条件", STOPPING: "正在停止后续调查" } as Record<string, string>)[view?.activeTurn?.progress?.phase ?? ""] ?? "正在读取和处理…"}</strong>
        {view?.activeTurn?.progress?.steps.map(s => <span key={s.id}>{s.status === "SUCCEEDED" ? "✓" : "·"} {s.label}</span>)}
        {view?.activeTurn?.progress && <button type="button" className="workspace-link focus-ring" disabled={view.activeTurn.progress.phase === "STOPPING"} onClick={() => { const epoch = generation.current; void api<{ conversation: ConversationView }>(`/api/conversations/${view.id}/turns/${view.activeTurn!.id}/stop`, "POST", {}).then(r => { if (epoch === generation.current) setView(r.conversation); }).catch(e => { if (epoch === generation.current) setError(e.message); }); }}>停止本轮调查</button>}</div>}
    </div>
    {error && <p role="alert" className={styles.error}>{error} {view && <button className="workspace-link focus-ring" onClick={() => void load(view.id, generation.current).catch(e => setError(e.message))}>读取原状态</button>}</p>}
    {view && <form className={styles.composer} onSubmit={ask}>
      {reply && <div className={styles.reply}>围绕：{reply.content.slice(0, 55)}<button type="button" className="workspace-link focus-ring" onClick={() => { setReply(null); pending.current = null; }}>取消追问</button></div>}
      <label className={styles.inputLabel}><textarea aria-label="与忆程讨论项目" value={text} onChange={e => setText(e.target.value)} maxLength={3000} placeholder="问忆程：先做什么？或请帮我继续…" disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}/></label>
      <div className={styles.composerFooter}><label className={styles.cloud} onMouseEnter={() => setShowCloudHelp(true)} onMouseLeave={() => setShowCloudHelp(false)} onFocus={() => setShowCloudHelp(true)} onBlur={() => setShowCloudHelp(false)} onContextMenu={event => { event.preventDefault(); setShowCloudHelp(v => !v); }} title="长按查看资料使用说明"><input type="checkbox" aria-label="允许云模型使用本次授权项目资料" checked={cloud} disabled={!analysisReady || !cloudAvailable || busy} onChange={e => { setCloud(e.target.checked); pending.current = null; }}/>{cloudAvailable ? "云端分析" : "本地整理"}</label>
      {view && <div className={styles.composerScope}>
      <label><select aria-label="讨论项目范围" value={target} disabled={busy || view.scope === "PROJECT"} onChange={e => { setTarget(e.target.value); pending.current = null; }}>
        <option value="">跨项目</option>{view.linkedProjects.map(p => <option value={p.id} key={p.id}>{p.title}</option>)}
        {projectId && !view.linkedProjects.some(p => p.id === projectId) && <option value={projectId}>当前项目</option>}
      </select></label>
      {target && <button type="button" className={styles.quietLink + " focus-ring"} onClick={() => setShowPreference(v => !v)}>项目偏好</button>}
      {projectId && <Link className="workspace-link focus-ring" href={conversationHref("/focus", view.id)}>回到原焦点讨论</Link>}
    </div>}
      {r4Available && cloud && <select className={styles.analysisMode} aria-label="调查深度" value={investigationMode} disabled={busy} onChange={e => { setInvestigationMode(e.target.value as typeof investigationMode); pending.current = null; }}><option value="QUICK">快速</option><option value="STANDARD">标准调查</option><option value="DEEP">深入调查 · 更多调用</option></select>}
      <button type="submit" className={styles.send + " focus-ring"} disabled={busy || !analysisReady || !text.trim()} aria-label="发送"><ArrowUp size={17}/></button></div>
      <p data-visible={showCloudHelp} className={styles.analysisHint}>{!analysisReady ? "正在确认分析方式…" : !cloudAvailable ? "未配置云模型，当前仅整理项目记录" : cloud ? "发送即允许云模型分析本次授权项目资料，可关闭" : "仅整理项目记录，不调用云模型"}</p>
    </form>}
  </section>;
}
function FocusPreference({ projectId, onError }: { projectId: string; onError: (v: string) => void }) {
  const [v, setV] = useState({ importance: "", longTermGoal: "", estimatedMinutes: "", notes: "", version: 0 });
  const [saving, setSaving] = useState(false);
  useEffect(() => { let live = true; void api<{ preference: null | { importance: number | null; longTermGoal: string; estimatedMinutes: number | null; notes: string; version: number } }>("/api/workspace/focus/preferences/" + projectId)
    .then(r => { if (live && r.preference) setV({ ...r.preference, importance: r.preference.importance?.toString() ?? "", estimatedMinutes: r.preference.estimatedMinutes?.toString() ?? "" }); }).catch(e => { if (live) onError(e.message); });
    return () => { live = false; }; }, [projectId, onError]);
  return <form className={styles.preference} onSubmit={e => {
    e.preventDefault(); setSaving(true);
    void api<{ preference: { version: number } }>("/api/workspace/focus/preferences/" + projectId, "PATCH", {
      expectedVersion: v.version, importance: v.importance ? Number(v.importance) : null, longTermGoal: v.longTermGoal,
      estimatedMinutes: v.estimatedMinutes ? Number(v.estimatedMinutes) : null, notes: v.notes,
    }).then(r => setV(old => ({ ...old, version: r.preference.version }))).catch(e => onError(e.message)).finally(() => setSaving(false));
  }}>
    <label>重要性<select aria-label="项目重要性" value={v.importance} onChange={e => setV({ ...v, importance: e.target.value })}><option value="">未明确</option>{[1, 2, 3, 4, 5].map(i => <option value={i} key={i}>{i}/5</option>)}</select></label>
    <label>本次投入（分钟）<input type="number" min="1" max="100000" value={v.estimatedMinutes} onChange={e => setV({ ...v, estimatedMinutes: e.target.value })}/></label>
    <label>长期目标<input value={v.longTermGoal} maxLength={300} onChange={e => setV({ ...v, longTermGoal: e.target.value })}/></label>
    <label>其他偏好<input value={v.notes} maxLength={500} onChange={e => setV({ ...v, notes: e.target.value })}/></label>
    <button className="workspace-tool focus-ring" disabled={saving}>保存偏好</button>
  </form>;
}
