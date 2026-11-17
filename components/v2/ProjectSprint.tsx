"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Timer, UserRound, Bot } from "lucide-react";
import type { SprintView } from "@/lib/types/sprint";
import styles from "./ProjectSprint.module.css";

export function ProjectSprint({ missionId, onOpenRevision }: { missionId: string; onOpenRevision: (revision: number) => void }) {
  const url = "/api/missions/" + encodeURIComponent(missionId) + "/sprint";
  const [view, setView] = useState<SprintView | null>(null), [objective, setObjective] = useState("");
  const [minutes, setMinutes] = useState(15), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [now, setNow] = useState(0), [fresh, setFresh] = useState(false), [uncertain, setUncertain] = useState(false);
  const pending = useRef<Record<string, unknown> | null>(null), alive = useRef(true);
  const mutationEpoch = useRef(0);
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
      } catch (cause) { if (alive.current) { setFresh(false); setError(cause instanceof Error ? cause.message : "读取失败"); } }
    }
    void read();
    const clock = setInterval(() => setNow(Date.now()), 1000), poll = setInterval(() => void read(), 4000);
    return () => { alive.current = false; clearInterval(clock); clearInterval(poll); };
  }, [url]);
  async function send(body: Record<string, unknown>) {
    if (busy) return;
    mutationEpoch.current++;
    pending.current ??= { ...body, requestId: crypto.randomUUID() };
    setBusy(true); setUncertain(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending.current) });
      const value = await response.json();
      if (!alive.current) return;
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) { pending.current = null; setUncertain(false); setFresh(false); }
        throw new Error(value.error?.message ?? "操作尚未确认，请重试原请求");
      }
      pending.current = null; setUncertain(false); setView(value); setFresh(true);
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : "操作尚未确认"); }
    finally { if (alive.current) setBusy(false); }
  }
  const session = view?.session, remaining = session ? Math.max(0, Math.ceil((Date.parse(session.endsAt) - now) / 1000)) : 0;
  const active = session?.status === "ACTIVE" && remaining > 0;
  return <section className={styles.sprint} aria-label="双人冲刺">
    <header><h2><Timer size={19} aria-hidden />双人冲刺</h2>{session && <span>{active ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : "本轮已结束"}</span>}</header>
    {session && <div className={styles.lanes}>
      <div><h3><UserRound size={18} aria-hidden />你的这一小步</h3><p>{session.objective}</p>
        <label><input type="checkbox" checked={session.selfReportedDone} disabled={!active || !fresh || busy || uncertain}
          onChange={event => void send({ action: "SELF_REPORT", sprintId: session.id, done: event.target.checked })} />我完成了 <small>个人自述</small></label></div>
      <div><h3><Bot size={18} aria-hidden />忆程的原委托</h3><p role="status">{fresh ? session.agent.label : "连接待恢复，进度待核对"}</p>
        <div className={styles.receipts}><span><CheckCircle2 size={16} aria-hidden />{session.agent.completedSteps} 个步骤回执</span><span><FileText size={16} aria-hidden />{session.agent.newOutputs} 份新稿</span></div>
        {session.agent.latestRevision !== null && <button type="button" onClick={() => onOpenRevision(session.agent.latestRevision!)}>打开成果与证据</button>}</div>
    </div>}
    {active ? <footer><button type="button" disabled={busy || uncertain || !fresh} onClick={() => void send({ action: "END", sprintId: session!.id })}>结束本轮</button><small>原委托继续按现有许可推进</small></footer> :
      <form onSubmit={event => { event.preventDefault(); void send({ action: "START", objective, minutes }); }}>
        <label>这轮你准备完成什么？<input value={objective} maxLength={300} placeholder="例如：核对报告中的两条引用" onChange={event => setObjective(event.target.value)} disabled={busy || uncertain} /></label>
        <div className={styles.start}><select aria-label="冲刺时长" value={minutes} onChange={event => setMinutes(Number(event.target.value))} disabled={busy || uncertain}><option value={5}>5 分钟</option><option value={15}>15 分钟</option><option value={25}>25 分钟</option></select>
          <button type="submit" disabled={!fresh || !view?.canStart || !objective.trim() || busy || uncertain}>一起推进</button></div>
        {view && !view.canStart && <p className={styles.hint}>{view.reason}</p>}
      </form>}
    {error && <p role="alert">{error}</p>}{uncertain && !busy && <button type="button" onClick={() => void send({})}>重试原冲刺请求</button>}
  </section>;
}
