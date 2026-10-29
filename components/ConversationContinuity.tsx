"use client";
import { useState } from "react";
import Link from "next/link";
import type { ConversationView } from "@/lib/types/conversation";
import type { Admission, DirectiveCommand, DirectiveScope } from "@/lib/types/continuity";

export function ConversationContinuity({ view, onChange, onError, onWork }: { view: ConversationView; onChange: (v: ConversationView) => void;
  onError: (message: string) => void; onWork: (kind: "MISSION" | "ACTION", id: string, projectId: string) => void }) {
  const ct = view.continuity;
  const [quote, setQuote] = useState(""), [editing, setEditing] = useState(false), [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState(""), [until, setUntil] = useState(""), [preview, setPreview] = useState<DirectiveCommand | null>(null);
  const [kind, setKind] = useState<"WORKING_OBJECTIVE" | "CONSTRAINT">("WORKING_OBJECTIVE");
  const [candidateId, setCandidateId] = useState<string | undefined>();
  const [candidateScope, setCandidateScope] = useState<DirectiveScope | undefined>();
  if (!ct) return null;
  const projectId = view.homeProjectId ?? view.focusProjectId;
  if (!projectId) return null;
  async function send(body: unknown, isPreview = false) {
    setSaving(true);
    try {
      const response = await fetch(`/api/conversations/${view.id}/continuity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "工作指引暂未保存");
      if (isPreview) { setPreview(result.command); return; }
      const admission = result.admission as Admission;
      if (result.events?.length) {
        setQuote(""); setEditing(false); setQuestion(""); setPreview(null); setCandidateId(undefined);
        const updated = await fetch(`/api/conversations/${view.id}`, { cache: "no-store" });
        if (!updated.ok) throw new Error("指引已保存，请读取原讨论状态"); onChange(await updated.json());
      } else setQuestion(admission.question ?? "这句话还未作为工作指引生效，请核对措辞和期限。");
    } catch (e) { onError(e instanceof Error ? e.message : "工作指引暂未保存"); }
    finally { setSaving(false); }
  }
  const base = (): DirectiveCommand => ({ commandId: crypto.randomUUID(), expectedSeq: ct.seq, scope: candidateId && candidateScope ? candidateScope : { projectId }, operation: "SET", quote: quote || undefined,
    candidateId, admission: "LITERAL", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  const openWork = async (kind: "MISSION" | "ACTION", id: string) => {
    try {
      const response = await fetch(`/api/conversations/${view.id}/continuity`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ openWork: { kind, id, projectId } }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "原任务暂不可访问");
      onWork(kind, id, projectId);
    } catch (e) { onError(e instanceof Error ? e.message : "原任务暂不可访问"); }
  }
  return <section aria-label="当前工作与接续" style={{ padding: "12px 0", borderBottom: "1px solid var(--border-subtle, #ddd)" }}>
    {ct.workingObjective && <p><strong>当前重点：</strong>{ct.workingObjective}</p>}
    {ct.stopped && <p role="status">这项工作已暂停</p>}
    {ct.directives.map(d => <div key={d.id} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 6 }}>
      <span>{d.quote}{d.validUntil && <small> · 到 {new Date(d.validUntil).toLocaleString("zh-CN")}</small>}</span>
      <button type="button" className="workspace-link focus-ring" disabled={saving} onClick={() => void send({ ...base(), scope: d.scope, operation: "WITHDRAW", directiveId: d.directiveId })}>撤回</button>
    </div>)}
    <button type="button" className="workspace-link focus-ring" onClick={() => setEditing(!editing)}>调整当前方向</button>
    {ct.candidate && <div><p>我理解你现在更关注：{ct.candidate.interpretation}</p><details><summary>查看你的原话</summary>{ct.candidate.quote} <Link href={`/focus?conversation=${ct.candidate.conversationId}`}>查看原讨论</Link></details>
      <button type="button" className="workspace-link focus-ring" onClick={() => { setQuote(ct.candidate!.interpretation); setKind(ct.candidate!.kind); setCandidateId(ct.candidate!.id); setCandidateScope(ct.candidate!.scope); setEditing(true); setQuestion("这项理解先持续到什么时候？"); setPreview(null); }}>核对这项理解</button></div>}
    {editing && <div>
      <input aria-label="更正当前工作方向" value={quote} onChange={e => { setQuote(e.target.value); setPreview(null); setQuestion(""); setCandidateId(undefined); }} placeholder="例如：本周先稳演示，先别加功能" maxLength={1000}/>
      <button type="button" className="workspace-link focus-ring" disabled={saving || !quote.trim()} onClick={() => candidateId ? setQuestion("这项理解先持续到什么时候？") : void send(base())}>按这句话调整</button>
      {question && <div><p role="status">{question}</p><label>有效到 <input type="datetime-local" aria-label="工作指引有效到" value={until} onChange={e => { setUntil(e.target.value); setPreview(null); }}/></label>
        <select aria-label="工作指引类型" value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="WORKING_OBJECTIVE">当前重点</option><option value="CONSTRAINT">工作限制</option></select>
        <button type="button" disabled={saving || !until} onClick={() => void send({ ...base(), kind, validUntil: new Date(until).toISOString(), preview: true }, true)}>核对调整内容</button>
      </div>}
      {preview && <div role="group" aria-label="工作指引确认"><p>{preview.scope.missionId ? "仅此委托" : "仅此项目"}：{preview.quote}，有效到 {new Date(preview.validUntil!).toLocaleString("zh-CN")}。</p>
        <button type="button" disabled={saving} onClick={() => void send(preview)}>确认这条工作指引</button><button type="button" onClick={() => setPreview(null)}>返回修改</button></div>}
    </div>}
    {ct.handoff?.missions.map(m => <p key={m.id}><button type="button" className="workspace-link focus-ring" onClick={() => void openWork("MISSION", m.id)}>{m.goal}</button> · {m.nextOwner === "USER" ? "等你接续" : m.status === "RUNNING" ? "Agent 处理中" : "等待 Agent 接续"}</p>)}
    {ct.handoff?.results.map(a => <p key={a.id}><button type="button" className="workspace-link focus-ring" onClick={() => void openWork("ACTION", a.id)}>{a.title}</button> · 已记录结果 <Link href={a.href}>查看原回执</Link></p>)}
  </section>;
}
