"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, BookOpen, Check, CheckCircle2, Clock3, FileText, Loader2, MessageSquareText, PauseCircle, Play, Timer, UserRound } from "lucide-react";
import { BookmarkSpirit } from "@/components/mascot/BookmarkSpirit";
import { SourceReader } from "./games/SourceReader";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import type { WorkbenchSnapshot } from "@/lib/types/workbench";
import type { SprintView } from "@/lib/types/sprint";
import styles from "./ProjectSprint.module.css";

type Props = {
  missionId: string; snapshot: WorkbenchSnapshot; onOpenRevision: (revision: number) => void;
  onPauseMission: () => Promise<void>; onDirective: (text: string) => Promise<{ applied: boolean; objective: string; message: string }>;
};

export function ProjectSprint({ missionId, snapshot, onOpenRevision, onPauseMission, onDirective }: Props) {
  const url = "/api/missions/" + encodeURIComponent(missionId) + "/sprint";
  const [view, setView] = useState<SprintView | null>(null), [objective, setObjective] = useState("");
  const [minutes, setMinutes] = useState(15), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(0), [fresh, setFresh] = useState(false), [uncertain, setUncertain] = useState(false);
  const [directive, setDirective] = useState(""), [directiveBusy, setDirectiveBusy] = useState(false), [directiveNote, setDirectiveNote] = useState("");
  const [confirmPause, setConfirmPause] = useState(false), [pauseBusy, setPauseBusy] = useState(false), [pauseNote, setPauseNote] = useState("");
  const [readerKey, setReaderKey] = useState<string | null>(null), [celebrate, setCelebrate] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null), alive = useRef(true), mutationEpoch = useRef(0), lastDraft = useRef<number | null>(null);
  useEffect(() => {
    alive.current = true;
    async function read() {
      if (pending.current) return;
      const epoch = mutationEpoch.current;
      try {
        const response = await fetch(url, { cache: "no-store" }), value = await response.json();
        if (!alive.current || epoch !== mutationEpoch.current) return;
        if (!response.ok) { if ([401, 403, 404].includes(response.status)) setView(null); throw new Error(value.error?.message ?? "冲刺状态暂时无法读取"); }
        setView(value); setFresh(true); setError(""); setNow(Date.now());
        const revision = value.session?.agent?.latestNewRevision ?? null;
        if (revision !== null && revision !== lastDraft.current) {
          if (lastDraft.current !== null) { setCelebrate(true); setTimeout(() => setCelebrate(false), 2400); }
          lastDraft.current = revision;
        }
      } catch (cause) { if (alive.current) { setFresh(false); setError(cause instanceof Error ? cause.message : "读取失败"); } }
    }
    void read();
    const clock = setInterval(() => setNow(Date.now()), 1000), poll = setInterval(() => void read(), 4000);
    return () => { alive.current = false; clearInterval(clock); clearInterval(poll); };
  }, [url]);
  async function send(body: Record<string, unknown>) {
    if (busy || (pending.current && body.action)) return;
    mutationEpoch.current++;
    pending.current ??= { ...body, requestId: crypto.randomUUID() };
    setBusy(true); setUncertain(true); setError("");
    const request = pending.current;
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
      const value = await response.json();
      if (!alive.current) return;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          pending.current = null; setUncertain(false); setFresh(false);
          if ([401, 403, 404].includes(response.status)) setView(null);
        }
        throw new Error(value.error?.message ?? "操作尚未确认，请重试原请求");
      }
      pending.current = null; setUncertain(false); setView(value); setFresh(true);
      if (request.action === "OPEN_SOURCE") setReaderKey(String(request.sourceKey));
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "操作尚未确认"); }
    finally { if (alive.current) setBusy(false); }
  }
  async function submitDirective() {
    const text = directive.trim();
    if (!text || directiveBusy) return;
    setDirectiveBusy(true); setDirectiveNote("");
    try {
      const result = await onDirective(text);
      setDirectiveNote(result.message);
      if (result.applied) setDirective("");
    } catch (cause) { setDirectiveNote(cause instanceof Error ? cause.message : "输入尚未确认，保留原文后可重试。"); }
    finally { setDirectiveBusy(false); }
  }
  async function pauseMission() {
    if (pauseBusy) return;
    setPauseBusy(true); setPauseNote("");
    try { await onPauseMission(); setPauseNote("已收到暂停请求；后台不再派发新步骤，本轮记录保留。"); setConfirmPause(false); }
    catch (cause) { setPauseNote(cause instanceof Error ? cause.message : "暂停尚未确认，请重试。"); }
    finally { setPauseBusy(false); }
  }
  const session = view?.session, remaining = session ? Math.max(0, Math.ceil((Date.parse(session.endsAt) - now) / 1000)) : 0;
  const active = session?.status === "ACTIVE" && remaining > 0;
  const latestSources = (snapshot.outputs[0]?.sourceKeys ?? []).map(key => snapshot.sources.find(source => source.key === key)).filter((source): source is NonNullable<typeof source> => !!source);
  const reader = readerKey ? latestSources.find(source => source.key === readerKey) : undefined;
  const wrapped = session && !active;
  const time = Math.floor(remaining / 60) + ":" + String(remaining % 60).padStart(2, "0");
  return <div className={styles.sprint}>
    <header className={styles.head}><div><p className={styles.eyebrow}>双人冲刺</p><h2>一起推进这一小步</h2></div>
      {session && <div className={styles.clock} data-active={active}><Timer size={17} aria-hidden /><span>{active ? time : session.status === "ENDED" ? "本轮已结束" : "计时结束"}</span></div>}</header>
    {!session ? <section className={styles.startCard}>
      <div className={styles.startCopy}><BookmarkSpirit pose={view?.canStart ? "inspect" : "thinking"} size={150}
        hint={view?.canStart ? "冲刺只记录真实步骤与稿件；计时本身不产生进度。" : "等原委托开始实际处理后再开启；先读已有成果也可以。"} />
        <div><h3>你核对一处，忆程继续改稿</h3><p>{view?.canStart ? "选一件这轮能做完的事。你可以边看原文，边跟进忆程的新稿。" : view?.reason ?? "正在读取原委托状态…"}</p></div></div>
      <form onSubmit={event => { event.preventDefault(); void send({ action: "START", objective, minutes }); }}>
        <label htmlFor="sprint-objective">这轮你准备完成什么？</label><input id="sprint-objective" value={objective} maxLength={300} placeholder="例如：核对报告中的两条引用"
          onChange={event => setObjective(event.target.value)} disabled={busy || uncertain} />
        <div className={styles.startRow}><select aria-label="冲刺时长" value={minutes} onChange={event => setMinutes(Number(event.target.value))} disabled={busy || uncertain}>
          <option value={5}>5 分钟</option><option value={15}>15 分钟</option><option value={25}>25 分钟</option></select>
          <button type="submit" className={styles.primary} disabled={!fresh || !view?.canStart || !objective.trim() || busy || uncertain}>
            {busy ? <><Loader2 size={15} className={styles.spin} aria-hidden />开始中…</> : <><Play size={15} aria-hidden />一起推进</>}</button></div>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {uncertain && !busy && <button type="button" className={styles.retry} onClick={() => void send({})}>重试原冲刺请求</button>}
    </section> : <>
      {wrapped && <section className={styles.wrap} aria-label="本轮收尾">
        <div><p className={styles.eyebrow}>这一轮，留下了什么</p><h3>{session.agent.newOutputs ? session.agent.newOutputs + " 份新稿" : "这一轮没有保存新稿"}</h3>
          <ul>{session.agent.newOutputs > 0 && <li><FileText size={14} aria-hidden />第 {session.agent.latestNewRevision} 版 · {evidenceTime(session.agent.latestNewOutputAt)}</li>}
            <li><BookOpen size={14} aria-hidden />{session.agent.openedSources} 处引用已打开</li>
            {session.agent.openItems.map(item => <li key={item}><Clock3 size={14} aria-hidden />{item}</li>)}</ul></div>
        <div className={styles.wrapActions}><span>{session.selfReportedDone ? "你的自述：已核对" : "你的自述：未勾选"}</span>
          {session.agent.latestNewRevision !== null && <button type="button" className={styles.primary} onClick={() => onOpenRevision(session.agent.latestNewRevision!)}>
            <FileText size={15} aria-hidden />看本轮变化</button>}</div>
      </section>}
      <div className={styles.layout}>
        <div className={styles.table}>
          <section className={styles.lane} aria-label="我的这一小步">
            <header><span className={styles.human}><UserRound size={15} aria-hidden />我</span><h3>我的这一小步</h3></header>
            <p className={styles.objective}>{session.objective}</p>
            <div className={styles.sourceList}><span>相关记录 ({latestSources.length})</span>{latestSources.slice(0, 3).map(source => <button type="button" key={source.key}
              onClick={() => {
                if (active) void send({ action: "OPEN_SOURCE", sprintId: session.id, sourceKey: source.key });
                else setReaderKey(source.key);
              }} disabled={!fresh || busy || uncertain || (active && !source.current)}><FileText size={14} aria-hidden /><span>{sourceDisplayName(source.id, source.name)}</span><time>{source.observedAt ? evidenceTime(source.observedAt) : "时间未记录"}</time></button>)}
              {!latestSources.length && <p>当前成果没有可打开的来源。</p>}</div>
            <label className={styles.selfReport}><input type="checkbox" checked={session.selfReportedDone} disabled={!active || !fresh || busy || uncertain}
              onChange={event => void send({ action: "SELF_REPORT", sprintId: session.id, done: event.target.checked })} /><span><strong>我核对完了</strong><small>我的自述 · 不推进忆程的步骤或稿件</small></span></label>
          </section>
          <section className={styles.lane} aria-label="忆程的工作">
            <header><h3>{wrapped ? "本轮步骤回执" : "忆程的工作"}</h3>
              {!wrapped && <span className={styles.agentState}>{fresh ? session.agent.label : "连接待恢复，进度待核对"}</span>}</header>
            <div className={styles.agentBody}><BookmarkSpirit pose={celebrate ? "success" : fresh && session.agent.working && active ? "writing" : "idle"} size={170} quiet={!fresh || !session.agent.working || !active}
              hint="步骤和稿件来自持久回执；没有回执就不显示完成。" />
              <ol className={styles.receipts}>{session.agent.receipts.length ? session.agent.receipts.map(receipt => <li key={receipt.id} data-kind={receipt.kind}>
                <span>{receipt.kind === "OUTPUT" ? <FileText size={13} aria-hidden /> : <Check size={13} aria-hidden />}</span>
                <div>{receipt.label}<time>{evidenceTime(receipt.at, true)}</time></div></li>) :
                <li className={styles.noReceipt}><span><Clock3 size={13} aria-hidden /></span><div>等待原委托保存步骤</div></li>}</ol></div>
          </section>
        </div>
        <aside className={styles.shelf} aria-label="本轮成果">
          {reader ? <SourceReader source={reader} excerpt={snapshot.outputs[0]?.blocks[0]?.text ?? ""} onClose={() => setReaderKey(null)} /> : <>
            {session.agent.latestNewRevision !== null ? <section className={styles.newDraft} aria-label="新稿已保存">
              <p className={styles.eyebrow}><CheckCircle2 size={13} aria-hidden />新稿已保存</p><h3>第 {session.agent.latestNewRevision} 版</h3><time>{evidenceTime(session.agent.latestNewOutputAt)}</time>
              <p>{snapshot.outputs.find(output => output.revision === session.agent.latestNewRevision)?.blocks[0]?.text.slice(0, 88) ?? "这一版的新稿已保存；打开查看变化与依据。"}</p>
              {!wrapped && <button type="button" className={styles.primary} onClick={() => onOpenRevision(session.agent.latestNewRevision!)}><FileText size={15} aria-hidden />打开新稿</button>}
            </section> : <section className={styles.pendingDraft}><FileText size={18} aria-hidden /><h3>{wrapped ? "本轮没有新稿" : "等待新稿保存"}</h3></section>}
            {!wrapped && <section className={styles.counts}><div><strong>{session.agent.completedSteps}</strong><span>个步骤回执</span></div><div><strong>{session.agent.newOutputs}</strong><span>份新稿</span></div>
              <div><strong>{session.agent.openedSources}</strong><span>处来源已打开</span></div></section>}
          </>}
        </aside>
      </div>
      <section className={styles.control} aria-label="自然语言改道">
        <MessageSquareText size={16} aria-hidden />
        <input value={directive} maxLength={3000} placeholder="先核对引用，暂时不要扩写" disabled={directiveBusy}
          onChange={event => setDirective(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitDirective(); } }} />
        <button type="button" aria-label="发送给原委托" onClick={() => void submitDirective()} disabled={!directive.trim() || directiveBusy}>
          {directiveBusy ? <Loader2 size={15} className={styles.spin} aria-hidden /> : <ArrowRight size={16} aria-hidden />}</button>
        {directiveNote && <p role="status" className={styles.directiveNote}>{directiveNote}</p>}
        {snapshot.workingObjective && <p className={styles.currentObjective}>当前工作重点：{snapshot.workingObjective}</p>}
      </section>
      <footer className={styles.footer}>
        {active || session.status === "ELAPSED" ? <button type="button" className={styles.secondary} disabled={busy || uncertain || !fresh}
          onClick={() => void send({ action: "END", sprintId: session.id })}>结束本轮</button> : null}
        <small>结束本轮只关闭这次冲刺，不暂停原委托。</small>
        <div className={styles.pauseBlock}>{confirmPause ? <><span>暂停会停止后台新步骤，本轮记录保留。</span>
          <button type="button" className={styles.danger} disabled={pauseBusy} onClick={() => void pauseMission()}>{pauseBusy ? "暂停中…" : "确认暂停原委托"}</button>
          <button type="button" className={styles.quiet} onClick={() => setConfirmPause(false)}>取消</button></> :
          <button type="button" className={styles.quiet} onClick={() => setConfirmPause(true)}><PauseCircle size={15} aria-hidden />暂停原委托</button>}
          {pauseNote && <p role="status" className={styles.pauseNote}>{pauseNote}</p>}</div>
      </footer>
    </>}
    {session && error && <p role="alert" className={styles.error}>{error}</p>}
    {session && uncertain && !busy && <button type="button" className={styles.retry} onClick={() => void send({})}>重试原冲刺请求</button>}
  </div>;
}
