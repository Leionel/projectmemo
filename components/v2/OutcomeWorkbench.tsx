"use client";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, BookOpen, Check, ChevronRight, Clock3, FileCheck2, FileText, GitCompareArrows, MessageSquareText, Plus, RefreshCw, Search } from "lucide-react";
import { SourceProvenance } from "@/components/SourceProvenance";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import { AgentMessageBlocks } from "@/components/AgentMessageBlocks";
import { highlightSegments, locateExcerpt } from "@/lib/challenges/presentation";
import { workbenchFixture } from "@/lib/experience/workbenchFixture";
import { workbenchArtifactMessage, workbenchMessage, type WorkbenchRevisionTarget, type WorkbenchSnapshot } from "@/lib/types/workbench";
import { ReentryBriefPanel } from "./ReentryBrief";
import { GAME_ENTRIES, MissionGames, type GameTab } from "./MissionGames";
import styles from "./OutcomeWorkbench.module.css";
import { MissionMaterialForm } from "./MissionMaterialForm";
import { RevisionComparison, type OpenRevisionSource } from "./RevisionComparison";
import { MissionQuestionPanel } from "./MissionQuestionPanel";
import { WorkbenchDelivery } from "./WorkbenchDelivery";

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function api(url: string, body?: unknown) {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {}, ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new RequestError(typeof value.error === "string" ? value.error : value.error?.message ?? "暂时无法读取，请重试原请求", response.status);
  return value;
}
const phaseLabels: Record<string, string> = { WAITING_OBSERVATION: "稿件已备好，继续留意变化", QUEUED: "已接到工作，等待后台推进",
  RUNNING: "正在处理获准资料", WAITING_USER: "有一个判断需要你", PAUSED: "跟进已暂停", COMPLETED: "跟进已结束", UNKNOWN: "当前状态需核对" };
type Pending = { conversationId: string; body: Record<string, unknown> };
type SourceSelection = { key: string; citedAt?: string; excerpt?: string };
function reveal(element: () => HTMLElement | null, block: ScrollLogicalPosition = "start") {
  window.requestAnimationFrame(() => {
    const target = element();
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  });
}
export function OutcomeWorkbench({ missionId, entry, initialRevision, initialBaseline }: {
  missionId?: string; entry?: "question" | "review"; initialRevision?: number; initialBaseline?: number;
}) {
  const live = !!missionId;
  const [snapshot, setSnapshot] = useState<WorkbenchSnapshot | null>(() => live ? null : workbenchFixture());
  const [research, setResearch] = useState(false), [selectedRevision, setSelectedRevision] = useState<number | null>(initialRevision ?? null);
  const [view, setView] = useState<"draft" | "diff">(entry === "review" && initialBaseline ? "diff" : "draft");
  const [compareRevision, setCompareRevision] = useState<number | null>(initialBaseline ?? null);
  const [feedbackSourceId, setFeedbackSourceId] = useState<string>();
  const [sourceSelection, setSourceSelection] = useState<SourceSelection | null>(null);
  const [materialOpen, setMaterialOpen] = useState(false);
  const documentTools = useRef<HTMLDivElement>(null), sourcePanelId = useId();
  const materialStart = useRef<HTMLDivElement>(null), composerInput = useRef<HTMLTextAreaElement>(null);
  const openSource = useCallback<OpenRevisionSource>((source, citedAt, excerpt) => {
    setSourceSelection({ key: source.key, citedAt, excerpt });
    reveal(() => document.getElementById(sourcePanelId), window.matchMedia("(max-width: 1050px)").matches ? "start" : "nearest");
  }, [sourcePanelId]);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [game, setGame] = useState<"mentor" | "evidence" | "sprint" | null>(null);
  const [questionReceipt, setQuestionReceipt] = useState(false);
  const [liveGame, setLiveGame] = useState<GameTab | null>(null);
  const [chosen, setChosen] = useState(""), [answer, setAnswer] = useState(""), [sprinting, setSprinting] = useState(false);
  const [sprintChecked, setSprintChecked] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const pending = useRef<Pending | null>(null), conversationId = useRef<string | null>(null);
  const snapshotRead = useRef({ seq: 0 });
  const refresh = useCallback(async () => {
    if (!missionId) return;
    const seq = ++snapshotRead.current.seq;
    try {
      const selection = new URLSearchParams();
      if (selectedRevision) selection.set("revision", String(selectedRevision));
      if (compareRevision) selection.set("from", String(compareRevision));
      const value = await api("/api/missions/" + encodeURIComponent(missionId) + "/workbench" + (selection.size ? "?" + selection : ""));
      if (seq !== snapshotRead.current.seq) return;
      setSnapshot(value);
      return value as WorkbenchSnapshot;
    } catch (e) {
      if (seq !== snapshotRead.current.seq) return;
      if (e instanceof RequestError && [401, 403, 404].includes(e.status)) {
        setSnapshot(null);
        setLiveGame(null);
        setSourceSelection(null);
        setMaterialOpen(false);
        setMessage("");
        pending.current = null;
        conversationId.current = null;
        setHasPending(false);
      }
      setError(e instanceof Error ? e.message : "读取失败");
    }
  }, [missionId, selectedRevision, compareRevision]);
  useEffect(() => {
    if (!missionId) return;
    const reads = snapshotRead.current;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try { await refresh(); } finally { inFlight = false; }
    };
    const first = setTimeout(() => void poll(), 0);
    const interval = setInterval(() => void poll(), 2500);
    return () => { reads.seq++; clearTimeout(first); clearInterval(interval); };
  }, [missionId, refresh]);
  const hasQuestion = snapshot?.reasonCode === "QUESTION_PENDING";
  const loaded = snapshot !== null;
  useEffect(() => {
    if (entry === "question" && hasQuestion) reveal(() => document.getElementById("workbench-question"));
    if (entry === "review" && loaded) reveal(() => document.getElementById("workbench-document"));
  }, [entry, hasQuestion, loaded]);
  /** 把一句话交给原 Conversation/Directive 链；返回值只描述真实应用结果。 */
  async function deliver(text: string): Promise<{ applied: boolean; objective: string; message: string }> {
    const quoted = text.trim();
    if (!quoted) throw new Error("先写一句要调整的方向。");
    if (!snapshot) throw new Error("工作台尚未读取完成。");
    if (!live) {
      const restricted = /不联网|不要联网/.test(quoted), paused = /^(暂停|停止)/.test(quoted);
      setSnapshot({ ...snapshot, workingObjective: quoted, phase: paused ? "PAUSED" : snapshot.phase,
        reason: paused ? "样例跟进已暂停" : restricted ? "样例：保持原成果，后续只使用本地资料" : "样例：已记录新的工作重点",
        events: [{ id: crypto.randomUUID(), label: "样例：收到你的改道输入", at: new Date().toISOString() }, ...snapshot.events] });
      return { applied: true, objective: quoted, message: "样例交互已更新；没有写入真实项目。" };
    }
    if (pending.current && String(pending.current.body.message) !== quoted)
      throw new Error("上一条输入尚未确认；请先在成果页重试原请求。");
    if (!pending.current) {
      if (!conversationId.current) {
        const created = await api("/api/conversations", { requestId: crypto.randomUUID(), scope: "PROJECT",
          projectId: snapshot.projectId, title: "成果工作台" });
        conversationId.current = created.id;
      }
      const c = await api("/api/conversations/" + conversationId.current);
      pending.current = { conversationId: c.id, body: { requestId: crypto.randomUUID(), expectedVersion: c.version,
        expectedContinuitySeq: c.continuity?.seq ?? 0, message: quoted, projectId: snapshot.projectId,
        entityRef: { kind: "MISSION", id: snapshot.id, projectId: snapshot.projectId } } };
      setHasPending(true);
    }
    const request = pending.current;
    let turn: { status?: string };
    try {
      turn = await api("/api/conversations/" + request.conversationId + "/turns", request.body);
    } catch (cause) {
      if (cause instanceof RequestError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        pending.current = null; setHasPending(false);
      }
      throw cause;
    }
    pending.current = null; setHasPending(false);
    if (turn.status === "FAILED" || turn.status === "UNKNOWN") throw new Error("原请求未取得可用结果，输入已保留。");
    const next = await refresh();
    if (!next) return { applied: false, objective: snapshot.workingObjective, message: "输入已送达，等待工作台重新读回。" };
    const before = new Set(snapshot.events.map(event => event.id));
    const applied = next.workingObjective !== snapshot.workingObjective ||
      next.events.some(event => event.kind === "NATURAL_CONTROL_APPLIED" && !before.has(event.id));
    return { applied, objective: next.workingObjective,
      message: applied ? "已按你的指引调整原委托；以当前状态为准。" : "输入已送达原委托，工作重点尚未变化；以当前状态为准。" };
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!snapshot || !message.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try { const result = await deliver(message); setMessage(""); setNotice(result.message); }
    catch (e) { setError(e instanceof Error ? e.message : "提交未确认，请重试原请求"); }
    finally { setBusy(false); }
  }
  async function control(action: "pause" | "cancel" | "resume"): Promise<boolean> {
    if (!snapshot || busy) return false;
    setBusy(true); setError("");
    try {
      // Controls bind to the current persisted version, not the last poll snapshot.
      const detail = await api("/api/missions/" + encodeURIComponent(snapshot.id));
      const current = detail.mission ?? detail;
      await api("/api/missions/" + encodeURIComponent(snapshot.id) + "/" + action, { requestId: crypto.randomUUID(), expectedVersion: current.version });
      setConfirmingEnd(false); setNotice(action === "pause" ? "已收到暂停请求，后台不再派发新步骤。" : action === "resume" ? "已恢复跟进；阶段成果与原报告都保留。" : "已结束持续跟进；已交付版本与依据仍然保留。");
      await refresh();
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "操作未确认，请重试"); return false; }
    finally { setBusy(false); }
  }
  function switchSample(value: boolean) {
    setResearch(value); setSnapshot(workbenchFixture(1, value)); setSelectedRevision(null); setSourceSelection(null); setCompareRevision(null); setFeedbackSourceId(undefined);
    setChosen(""); setNotice(""); setAnswer(""); setSprintChecked(false); setSprinting(false);
  }
  if (!snapshot) return <main className={styles.loading}><h1>成果工作台</h1><p role="status">{error || "正在读取原委托…"}</p>
    {error && <><button onClick={() => void refresh()}>重试读取</button><a href="/login">登录后继续</a></>}</main>;
  const output = selectedRevision === null ? snapshot.outputs[0] : snapshot.outputs.find(o => o.revision === selectedRevision);
  const latestOutput = snapshot.outputs[0] ?? null;
  const artifact = snapshot.stageArtifacts.find(item => item.id === selectedArtifactId) ?? snapshot.stageArtifacts[0];
  const stageReady = snapshot.reasonCode === "SKILL_DELIVERABLE_READY";
  const olderVersions = output ? snapshot.outputs.filter(row => row.revision < output.revision) : [];
  const previous = compareRevision === null ? olderVersions[0] : olderVersions.find(row => row.revision === compareRevision);
  const selectedSourceKey = sourceSelection?.key;
  const source = selectedSourceKey ? snapshot.sources.find(row => row.key === selectedSourceKey) :
    snapshot.sources.find(row => output?.sourceKeys.includes(row.key)) ??
    snapshot.sources.find(row => artifact?.sourceKeys.includes(row.key));
  const excerpt = source && sourceSelection?.excerpt ? locateExcerpt(source.text, sourceSelection.excerpt) : null;
  const currentSourceIds = output?.blocks.flatMap(b => b.sourceIds) ?? [];
  function openComposer() { reveal(() => composerInput.current, "center"); }
  function prepareQuestion(text: string) {
    if (!hasPending && !busy) {
      setMessage(current => current.trim() ? current : "今天先核对" + text);
      setNotice("请在输入框确认要核对的内容，然后发送给原委托。");
    }
    openComposer();
  }
  function openMaterial() { setMaterialOpen(true); reveal(() => materialStart.current); }
  async function reread() { await refresh(); }
  async function questionAnswered() { setQuestionReceipt(true); await refresh(); }
  function selectRevision(revision: number) {
    setSelectedRevision(revision); setCompareRevision(null); setSourceSelection(null); setFeedbackSourceId(undefined);
  }
  function openRevision(revision: number, compare = false, baseline?: number) {
    selectRevision(revision); setCompareRevision(baseline ?? null); setView(compare ? "diff" : "draft"); setLiveGame(null);
    reveal(() => documentTools.current);
  }
  function openFeedbackChanges(target: WorkbenchRevisionTarget) {
    openRevision(target.revision, true, target.baselineRevision);
    setFeedbackSourceId(target.sourceId);
  }
  async function pauseFromGame() { const ok = await control("pause"); if (!ok) throw new Error("暂停尚未确认，请重试。"); }
  return <main className={styles.workbench}>
    <div className={styles.topline}><a href="/focus">忆程 <ChevronRight size={14} aria-hidden="true" /> 成果工作台</a>
      <span>{live ? (snapshot.provider.startsWith("INJECTED") ? "隔离流程演示 · 注入模型" : "原委托实时读回") : "可点击交互样例 · 未运行模型"}</span></div>
    {!liveGame && <header className={styles.heading}><div><p>{snapshot.projectTitle}</p><h1>{snapshot.goal}</h1>
      <div className={styles.state} role="status"><span aria-hidden="true" className={styles.dot} />
        {stageReady ? snapshot.reason : phaseLabels[snapshot.phase] ?? snapshot.reason}</div></div>
      {live ? <div className={styles.controls}><button type="button" className={styles.primary} onClick={openMaterial}><Plus size={16} aria-hidden />补资料</button><button className={styles.secondary} onClick={() => void refresh()}><RefreshCw size={15} aria-hidden="true" />重新读取</button>{stageReady && <button className={styles.secondary} disabled={busy} onClick={() => void control("resume")}>继续跟进</button>}<button className={styles.secondary} disabled={busy || snapshot.status !== "READY" && snapshot.phase !== "WAITING_OBSERVATION"} onClick={() => void control("pause")}>暂停跟进</button><button className={styles.secondary} disabled={busy} onClick={() => void (confirmingEnd ? control("cancel") : setConfirmingEnd(true))}>{confirmingEnd ? "确认结束跟进" : "结束跟进"}</button></div> :
        <div className={styles.sampleChoices}><button aria-pressed={!research} onClick={() => switchSample(false)}>开发样例</button>
          <button aria-pressed={research} onClick={() => switchSample(true)}>科研对照</button></div>}
    </header>}
    {!live && <div className={styles.sampleBar}><p>用一条新资料体验同一份成果的接续修改。</p><button className={styles.secondary}
      disabled={snapshot.outputs.length >= 2} onClick={() => { setSnapshot(workbenchFixture(2, research)); selectRevision(2); }}>
      载入新资料样例 <ArrowUpRight size={15} aria-hidden="true" /></button></div>}
    {error && <div role="alert" className={styles.error}>{error}{hasPending && "；原请求编号已保留，再次发送会重试原请求。"}</div>}
    {live && !liveGame && <ReentryBriefPanel key={missionId} missionId={missionId} projectId={snapshot.projectId} outputs={snapshot.outputs}
      onOpenRevision={openRevision} onAddMaterial={openMaterial} onOpenQuestion={() => reveal(() => document.getElementById("workbench-question"))} />}
    {live && hasQuestion && !liveGame && <MissionQuestionPanel missionId={missionId} projectId={snapshot.projectId} version={snapshot.version} onAnswered={questionAnswered} />}
    {questionReceipt && !hasQuestion && <p role="status" className={styles.notice}>原问题答复已提交，可在过程回执里查看后续进展。</p>}
    {entry === "question" && !hasQuestion && !questionReceipt && <p role="status" className={styles.notice}>原委托目前没有等待答复的问题。</p>}
    {live && snapshot.challengesEnabled && !liveGame && <section className={styles.gameEntry} aria-label="成果玩法入口">
      <h2>成果演练</h2>
      <div className={styles.gameEntryActions}>{GAME_ENTRIES.map(({ key, label, icon: Icon }) =>
        <button type="button" key={key} onClick={() => setLiveGame(key)}><Icon size={16} aria-hidden />{label}</button>)}</div>
    </section>}
    {live && snapshot.challengesEnabled && liveGame && <MissionGames missionId={snapshot.id} snapshot={snapshot} output={latestOutput} latestOutput={latestOutput}
      tab={liveGame} onTab={setLiveGame} onExit={() => setLiveGame(null)} onHandoff={reread} onOpenRevision={openRevision}
      onReviewFeedback={openFeedbackChanges} onPauseMission={pauseFromGame} onDirective={deliver} />}
    {!liveGame && <div className={styles.workspace}>
      <aside className={styles.progress} aria-label="Agent过程反馈"><h2>这份成果的进展</h2>
        <p className={styles.objective}>{snapshot.workingObjective}</p>
        <ol>{snapshot.events.slice(0, 8).map(event => { const Icon = event.kind === "TOOL_STARTED" || event.kind === "CLAIMED" ? Clock3 : event.kind === "SKILL_ENTERED" ? Search : event.kind === "SKILL_HANDOFF" ? ArrowUpRight : event.kind === "OUTPUT_SAVED" ? FileCheck2 : event.kind?.startsWith("USER_") ? MessageSquareText : Check;
          return <li key={event.id}><Icon size={14} aria-hidden="true" /><div>{event.label}<time dateTime={event.at}>{evidenceTime(event.at, true)}</time></div></li>; })}</ol>
        <div className={styles.usage}>{live ? <><span>模型调用 {snapshot.models}</span><span>工具调用 {snapshot.tools}</span></> : "样例操作不会调用模型"}
          <small>{live ? "读取时间" : "样例时点"} {new Date(snapshot.checkedAt).toLocaleTimeString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）</small></div>
      </aside>
      <section className={styles.document} id="workbench-document" aria-label="项目成果" tabIndex={-1}>
        {artifact && <section className={styles.stageArtifacts} aria-label="阶段成果">
          <div className={styles.documentHead}><div className={styles.views}><h2><FileText size={15} aria-hidden="true" />阶段成果</h2></div>
            <div className={styles.versions} aria-label="阶段成果列表">{snapshot.stageArtifacts.map(item => <button key={item.id}
              aria-pressed={item.id === artifact.id} onClick={() => { setSelectedArtifactId(item.id); setSourceSelection(null); }}>{item.label}</button>)}</div></div>
          <p className={styles.paperLabel}>{artifact.label} · 原报告与业务行动未改动</p>
          <AgentMessageBlocks message={workbenchArtifactMessage(artifact, snapshot.projectId, snapshot.provider)}
            conversationId={"workbench-artifact-" + snapshot.id} busy={busy} onAction={async () => { /* Read-only presentation has no business actions. */ }} />
          <div className={styles.references}><span>本阶段依据</span>{[...new Set(artifact.blocks.flatMap(block => block.sourceIds))].map(id => {
            const found = snapshot.sources.find(item => item.id === id && artifact.sourceKeys.includes(item.key));
            return found ? <button key={id} onClick={() => openSource(found, artifact.createdAt)}><BookOpen size={14} aria-hidden="true" />定位原记录{found.name ? " · " + found.name : ""}</button> : null;
          })}{artifact.unknowns.length > 0 && <p>仍未知：{artifact.unknowns.join("；")}</p>}</div>
        </section>}
        <div className={styles.documentHead} ref={documentTools} tabIndex={-1}><div className={styles.views}>
          <button aria-pressed={view === "draft"} onClick={() => { setView("draft"); setSourceSelection(null); setFeedbackSourceId(undefined); }}><FileText size={15} aria-hidden="true" />成果</button>
          <button aria-pressed={view === "diff"} onClick={() => { setView("diff"); setSourceSelection(null); }}><GitCompareArrows size={15} aria-hidden="true" />修改对照</button></div>
          <div className={styles.versions} aria-label="成果版本">{snapshot.outputs.map(o => <button key={o.id}
            aria-pressed={output?.id === o.id} aria-label={"第 " + o.revision + " 版"} onClick={() => selectRevision(o.revision)}><Clock3 size={14} aria-hidden="true" /><span><strong>第 {o.revision} 版</strong><time dateTime={o.createdAt}>{evidenceTime(o.createdAt, true)}</time></span></button>)}</div>
        </div>
        {output ? <div className={styles.paper}>
          <p className={styles.paperLabel}><FileText size={14} aria-hidden="true" /><span>私有工作稿</span><time dateTime={output.createdAt}>{evidenceTime(output.createdAt)}</time></p>
          {view === "draft" ? <AgentMessageBlocks message={workbenchMessage(output, snapshot.projectId, snapshot.provider)}
            conversationId={"workbench-view-" + snapshot.id} busy={busy} onAction={async () => { /* Read-only presentation has no business actions. */ }} /> :
            previous ? <>
              {olderVersions.length > 1 && <label className={styles.comparePicker}>对照起点
                <select value={previous.revision} onChange={event => { setCompareRevision(Number(event.target.value)); setSourceSelection(null); setFeedbackSourceId(undefined); }}>
                  {olderVersions.map(row => <option key={row.id} value={row.revision}>第 {row.revision} 版 · {evidenceTime(row.createdAt, true)}</option>)}
                </select>
              </label>}
              <RevisionComparison baseline={previous} output={output} sources={snapshot.sources} onOpenSource={openSource}
                feedbackSourceId={feedbackSourceId} onClearFilter={() => setFeedbackSourceId(undefined)} />
            </> : <p className={styles.empty}>{compareRevision !== null ? "所选对照起点暂不可读。" : "没有更早的稿件可供对照。新资料更新后，可在这里比较。"}</p>}
          {view === "draft" && <div className={styles.references}><span>本稿依据</span>{currentSourceIds.length ? [...new Set(currentSourceIds)].map(id => {
            const found = snapshot.sources.find(s => s.id === id && output.sourceKeys.includes(s.key));
            return found ? <button key={id} onClick={() => openSource(found, output.createdAt)}><BookOpen size={14} aria-hidden="true" />定位原记录{found.name ? " · " + found.name : ""}</button> : null;
          }) : <p>这版内容仅为推断或来源需要重新核对。</p>}</div>}
        </div> : <p className={styles.empty}>{selectedRevision !== null ? "所选稿件暂不可读，请重新选择版本。" : "原委托还没有生成报告稿。"}</p>}
        {live && output && <WorkbenchDelivery key={output.id + ":" + (previous?.revision ?? 0)} missionId={missionId}
          projectId={snapshot.projectId} output={output} baseline={previous?.revision} adoptionEnabled={snapshot.artifactAdoptionEnabled} />}
        {!live && <div className={styles.games}><span>围绕这份成果试一试</span>
          <button aria-pressed={game === "mentor"} onClick={() => setGame(game === "mentor" ? null : "mentor")}>严格导师</button>
          <button aria-pressed={game === "evidence"} onClick={() => setGame(game === "evidence" ? null : "evidence")}>证据侦探</button>
          <button aria-pressed={game === "sprint"} onClick={() => setGame(game === "sprint" ? null : "sprint")}>双人冲刺</button></div>}
        {!live && game && <section className={styles.game} aria-label="成果挑战">
          {game === "mentor" && <><h2>交付前，先回答这三个追问</h2><ol><li>这份稿中，哪一句能直接定位到原记录？</li>
            <li>哪一个条件仍然未知，不能写成结论？</li><li>新资料改变了哪一处交付判断？</li></ol>
            <label htmlFor="mentor-answer">记下这份成果的缺口</label><textarea id="mentor-answer" value={answer} onChange={e => setAnswer(e.target.value)} maxLength={500} />
            <button className={styles.secondary} disabled={!answer.trim()} onClick={() => prepareQuestion(answer)}>交给原委托核查</button></>}
          {game === "evidence" && <><h2>找到这版成果真正引用的记录</h2><p>{output?.blocks[0]?.text ?? "先准备一版成果再开始。"}</p>
            <div className={styles.evidenceChoices}>{snapshot.sources.map(s => <button key={s.key} aria-pressed={chosen === s.key}
              onClick={() => { setChosen(s.key); setSourceSelection({ key: s.key }); }}>{s.text.slice(0, 70)}</button>)}</div>
            {chosen && <p role="status">{output?.sourceKeys.includes(chosen)
              ? "这份记录出现在本稿引用中。引用关系不等于结论已经被验证。" : "这份记录没有出现在当前版本的引用中，可对照另一版查看。"}</p>}</>}
          {game === "sprint" && <><h2>你核对一处依据，忆程保持原委托的工作</h2>
            <p>你的工作：读右侧记录，找出一项需要核对的条件。</p><p>Agent当前：{snapshot.reason}</p>
            <button className={styles.secondary} onClick={() => setSprinting(!sprinting)}>{sprinting ? "结束本次分工" : "开始这次分工"}</button>
            {sprinting && <label className={styles.checkbox}><input type="checkbox" checked={sprintChecked} onChange={e => setSprintChecked(e.target.checked)} />我已核对原记录</label>}
            {sprintChecked && <p>已记下你的自述；这不会把项目行动标记为完成。</p>}</>}
        </section>}
        {live && <div className={styles.anchor} ref={materialStart} tabIndex={-1} aria-label="材料表单"><MissionMaterialForm missionId={snapshot.id} projectId={snapshot.projectId}
          open={materialOpen} onOpenChange={setMaterialOpen} onSaved={reread} /></div>}
        <form className={styles.composer} onSubmit={submit}><label htmlFor="workbench-message">接下来怎么做，直接告诉忆程</label>
          <textarea ref={composerInput} id="workbench-message" value={message} disabled={busy || hasPending} onChange={e => setMessage(e.target.value)}
            placeholder="例如：继续整理，但不要联网" maxLength={3000} required />
          <div><span>修改工作方向，保留已有成果和用量。</span><button type="submit" className={styles.primary} disabled={busy || !message.trim()}>
            {busy ? "正在提交…" : hasPending ? "重试原请求" : "发送"}<ArrowUpRight size={16} aria-hidden="true" /></button></div>
        </form>
        {notice && <p role="status" className={styles.notice}>{notice}</p>}
      </section>
      <aside className={styles.source} aria-label="证据定位" id={sourcePanelId} tabIndex={-1}><div><BookOpen size={17} aria-hidden="true" /><h2>原始依据</h2></div>
        {source ? <SourceProvenance className={styles.sourceMeta} name={sourceDisplayName(source.id, source.name)} observedAt={source.observedAt} current={source.current} external={source.kind === "EXTERNAL"}
          referencedAt={sourceSelection?.citedAt ?? (output?.sourceKeys.includes(source.key) ? output.createdAt : artifact?.sourceKeys.includes(source.key) ? artifact.createdAt : undefined)}
          technical={[{ label: "来源标识", value: source.id }, { label: "修订标识", value: source.revision }, ...(source.revision !== source.hash ? [{ label: "内容校验", value: source.hash }] : [])]}>
          <blockquote data-testid="source-excerpt">{highlightSegments(source.text, excerpt).map((part, index) =>
            part.marked ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>)}</blockquote>
          {live && <button className={styles.sourceAction} type="button" disabled={busy || hasPending} onClick={() => prepareQuestion(" " + sourceDisplayName(source.id, source.name) + "（" + evidenceTime(source.observedAt, true) + "）对当前稿的影响")}>
            <MessageSquareText size={15} aria-hidden />请忆程核对这条
          </button>}
        </SourceProvenance> : <p className={styles.emptySource}>{selectedSourceKey ? "这条引用当前不可读，请核对来源许可。" : "当前稿还没有可读的引用。"}</p>}
      </aside>
    </div>}
  </main>;
}
