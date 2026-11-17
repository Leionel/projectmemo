"use client";
import { useEffect, useRef, useState } from "react";
import type { ChallengeKind, ChallengeSession } from "@/lib/types/challenge";
import styles from "./OutcomeChallenges.module.css";

type Pending = { url: string; body: Record<string, unknown> };
export function OutcomeChallenges({ missionId, outputId, onSource, onHandoff }: {
  missionId: string; outputId?: string; onSource: (key: string) => void; onHandoff: () => Promise<void>;
}) {
  const base = "/api/missions/" + encodeURIComponent(missionId) + "/challenges";
  const [session, setSession] = useState<ChallengeSession | null>(null), [visible, setVisible] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({}), [choices, setChoices] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [error, setError] = useState("");
  const pending = useRef<Pending | null>(null);
  const mutationEpoch = useRef(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      if (pending.current) return;
      const epoch = mutationEpoch.current;
      try {
        const response = await fetch(base, { cache: "no-store" }), value = await response.json();
        if (!active || epoch !== mutationEpoch.current) return;
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) setSession(null);
          throw new Error(value.error?.message ?? "挑战读取失败，可刷新重试");
        }
        setSession(value.session);
      } catch (cause) { if (active) setError(cause instanceof Error ? cause.message : "挑战暂时无法读取"); }
    };
    void read(); const interval = setInterval(() => void read(), 5000);
    return () => { active = false; clearInterval(interval); };
  }, [base, outputId]);
  async function send(body: Record<string, unknown>, starting = false) {
    if (busy) return;
    mutationEpoch.current++;
    pending.current ??= { url: starting ? base : base + "/" + session!.id, body: { ...body, requestId: crypto.randomUUID() } };
    setBusy(true); setUncertain(true); setError("");
    const request = pending.current;
    try {
      const response = await fetch(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.body) });
      const value = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          pending.current = null; setUncertain(false);
          const fresh = await fetch(base, { cache: "no-store" });
          if (fresh.ok) setSession((await fresh.json()).session); else setSession(null);
        }
        throw new Error(value.error?.message ?? "提交尚未确认，请重试原请求");
      }
      pending.current = null; setUncertain(false); setSession(value.session); setVisible(request.body.action !== "STOP");
      if (request.body.action === "DELETE_ATTEMPT") { setDrafts({}); setChoices({}); }
      if (request.body.action === "OPEN_SOURCE") onSource(String(request.body.sourceKey));
      if (request.body.action === "HANDOFF") await onHandoff();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "提交尚未确认，请重试原请求"); }
    finally { setBusy(false); }
  }
  const open = visible || session?.status === "ACTIVE" || session?.status === "COMPLETED";
  const question = session?.questions[session.answers.length], selected = question ? choices[question.key] ?? [] : [];
  const start = (kind: ChallengeKind) => void send({ kind, outputId }, true);
  return <section className={styles.challenge} aria-label="成果挑战">
    <div className={styles.entry}><span>交付前，核对一处真实缺口</span>
      <button type="button" disabled={busy || uncertain || !outputId || session?.status === "ACTIVE"} onClick={() => start("REHEARSAL")}>严格导师 · 三轮彩排</button>
      <button type="button" disabled={busy || uncertain || !outputId || session?.status === "ACTIVE"} onClick={() => start("EVIDENCE")}>证据侦探 · 引用追溯</button>
      <button type="button" disabled={busy || uncertain || !outputId || session?.status === "ACTIVE"} onClick={() => start("METRIC")}>指标核对 · 可比性</button></div>
    {!outputId && <p>先准备一版有来源的成果，再开始。</p>}
    {error && <p role="alert">{error}</p>}
    {uncertain && !busy && <button type="button" onClick={() => void send({})}>重试原挑战请求</button>}
    {open && session && <div className={styles.body}>
      <header><h2>{session.kind === "REHEARSAL" ? "交付彩排" : session.kind === "METRIC" ? "指标可比性" : "引用追溯"} · 第 {session.revision} 版</h2>
        <button type="button" disabled={busy || uncertain} onClick={() => { if (["ACTIVE", "COMPLETED"].includes(session.status)) void send({ action: "STOP" }); else setVisible(false); }}>退出本轮</button></header>
      {session.handoffSourceId ? <p role="status">核查意见已保存，原委托会按现有许可继续。新版本会显示在上方。</p> :
        session.status === "STALE" ? <p role="status">{session.reason}。可保留已输入的文字，从当前版本重新开始。</p> :
        session.status === "STOPPED" ? <p role="status">本轮已退出，原委托继续保留。</p> : <>
          {question ? <form onSubmit={event => { event.preventDefault(); void send({ action: "ANSWER", questionKey: question.key,
            ...(session.kind === "REHEARSAL" ? { text: drafts[question.key] ?? "" } : { selected }) }); }}>
            <p className={styles.progress}>第 {session.answers.length + 1} / {session.questions.length} 轮</p>
            <h3>{question.title}</h3><blockquote>{question.excerpt}</blockquote>
            {session.kind === "REHEARSAL" ? <label>本轮核查意见<textarea rows={3} maxLength={1200} disabled={busy || uncertain}
              value={drafts[question.key] ?? ""} onChange={event => setDrafts({ ...drafts, [question.key]: event.target.value })} required /></label> :
              <fieldset><legend>{session.kind === "METRIC" ? "选择一项条件判断" : "选择这段稿件实际使用的来源"}</legend>{question.options.map(option => <label className={styles.option} key={option.key}>
                <input type="checkbox" disabled={busy || uncertain} checked={selected.includes(option.key)} onChange={event => setChoices({ ...choices,
                  [question.key]: event.target.checked ? [...selected, option.key] : selected.filter(key => key !== option.key) })} />{option.label}</label>)}</fieldset>}
            <div className={styles.actions}><button type="submit" disabled={busy || uncertain || (session.kind === "REHEARSAL" ? !drafts[question.key]?.trim() : session.kind === "METRIC" ? selected.length !== 1 : !selected.length)}>保存本轮回答</button></div>
          </form> : <p role="status">{session.kind === "REHEARSAL" ? "三项核查意见已保存；交回原委托后再修订稿件。" :
            session.kind === "METRIC" ? (session.answers[0]?.verdict === "LINK_MATCH" ? "判断与已提供的指标条件一致；实验结果仍待独立核验。" : "判断与记录条件有差异，请核对未知项与口径。") :
            session.answers[0]?.verdict === "LINK_MATCH" ? "已找到这段稿件的全部引用；还可以核对来源是否支持这段表述。" : "选择与稿件引用有差异，可以打开原记录继续核对。"}</p>}
          <div className={styles.sources}>{session.sourceKeys.map((key, index) => <button type="button" key={key} disabled={busy || uncertain}
            onClick={() => void send({ action: "OPEN_SOURCE", sourceKey: key })}>查看资料 {index + 1}{session.openedSourceKeys.includes(key) ? " · 已打开" : ""}</button>)}</div>
          {session.answers.length > 0 && <details><summary>已保存的回答（{session.answers.length}）</summary>{session.answers.map(answer =>
            <p key={answer.questionKey}>{answer.text || (answer.verdict === "LINK_MATCH" ? "已定位引用" : "引用仍待核对")}</p>)}</details>}
          {session.status === "COMPLETED" && <button type="button" className={styles.handoff} disabled={busy || uncertain}
            onClick={() => void send({ action: "HANDOFF" })}>把核查缺口交回原委托</button>}
        </>}
      <div className={styles.actions}><button type="button" disabled={busy || uncertain} onClick={() => void send({ action: "DELETE_ATTEMPT" })}>删除本轮回答及交回反馈</button></div>
    </div>}
  </section>;
}
