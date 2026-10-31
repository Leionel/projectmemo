"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarPlus } from "lucide-react";
import type { ConversationView } from "@/lib/types/conversation";
import styles from "./ConversationPanel.module.css";

type Connection = { id: string; accountName: string; accountEmail: string; calendarSummary: string; calendarId: string; connected: boolean; writeCapable: boolean };

async function api<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const r = await fetch(url, { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined });
  const value = await r.json();
  if (!r.ok) throw Object.assign(new Error(value.error?.message ?? "日历提案暂不可用"), { status: r.status, code: value.error?.code });
  return value as T;
}

/** User-initiated external write proposal: freeze exact payload, then the original confirm card sends it. */
export function ConversationCalendarComposer({ conversationId, projectId, version, disabled, onCreated, onError }: {
  conversationId: string; projectId: string; version: number; disabled: boolean;
  onCreated: (conversation: ConversationView) => void; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false), [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ connectionId: "", title: "", description: "", allDay: false, start: "", end: "", recurrence: "", attendees: "", attachments: "" });
  const requests = useRef(new Map<string, string>());
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<{ connections: Connection[] }>(`/api/projects/${encodeURIComponent(projectId)}/calendar-connections`)
      .then(r => { if (live) setConnections(r.connections); }).catch(e => { if (live) onError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [open, projectId, onError]);
  const writable = connections.filter(c => c.connected && c.writeCapable), connection = writable.find(c => c.id === form.connectionId) ?? writable[0];
  const ready = !!connection && form.title.trim().length >= 2 && !!form.start && !!form.end && !disabled && !saving;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || !connection) return;
    const startAt = form.allDay ? form.start : new Date(form.start).toISOString();
    const endAt = form.allDay ? form.end : new Date(form.end).toISOString();
    const attendees = form.attendees.split(/[,，\s]+/).filter(Boolean).map(value => value.startsWith("ou_")
      ? { type: "open_id" as const, openId: value } : { type: "email" as const, email: value });
    const attachments = form.attachments.split(/[,，\s]+/).filter(Boolean);
    const body = { projectId, connectionId: connection.id, title: form.title.trim(), description: form.description.trim(), timeZone: zone,
      allDay: form.allDay, recurrence: form.recurrence.trim() || null, startAt, endAt, attendees, attachments };
    const intent = JSON.stringify(body), requestId = requests.current.get(intent) ?? crypto.randomUUID();
    requests.current.set(intent, requestId);
    setSaving(true); onError("");
    try {
      const created = await api<{ conversation: ConversationView }>(`/api/conversations/${conversationId}/calendar-proposals`, "POST",
        { ...body, requestId, expectedVersion: version });
      requests.current.delete(intent);
      onCreated(created.conversation);
      setOpen(false); setForm({ connectionId: "", title: "", description: "", allDay: false, start: "", end: "", recurrence: "", attendees: "", attachments: "" });
    } catch (error) { onError(error instanceof Error ? error.message : "日历提案创建失败"); }
    finally { setSaving(false); }
  }
  if (!open) return <button type="button" className={styles.quietLink + " focus-ring"} disabled={disabled} onClick={() => { setOpen(true); setLoading(true); }}>
    <CalendarPlus size={12}/> 创建飞书日程
  </button>;
  return <form className={styles.calendarComposer} onSubmit={submit} aria-label="创建飞书日程提案">
    <div className={styles.calendarHead}><strong>创建飞书日程</strong><button type="button" className="workspace-link focus-ring" onClick={() => setOpen(false)}>收起</button></div>
    {loading ? <p role="status">正在读取日历连接…</p> : !writable.length
      ? <p>当前项目没有已授权写入的飞书日历，请先在项目页连接并授权写入。</p>
      : <>
        <label>日历<select value={connection?.id ?? ""} onChange={e => setForm({ ...form, connectionId: e.target.value })}>
          {writable.map(c => <option value={c.id} key={c.id}>{(c.accountName || c.accountEmail) + " / " + c.calendarSummary}</option>)}
        </select></label>
        <label>标题<input value={form.title} maxLength={160} placeholder="例：小组讨论" onChange={e => setForm({ ...form, title: e.target.value })}/></label>
        <label>开始<input type={form.allDay ? "date" : "datetime-local"} value={form.start} onChange={e => setForm({ ...form, start: e.target.value })}/></label>
        <label>结束<input type={form.allDay ? "date" : "datetime-local"} value={form.end} onChange={e => setForm({ ...form, end: e.target.value })}/></label>
        <label className={styles.calendarCheck}><input type="checkbox" checked={form.allDay} onChange={e => setForm({ ...form, allDay: e.target.checked })}/> 全天</label>
        <label>重复<input value={form.recurrence} placeholder="可选，如 FREQ=WEEKLY;BYDAY=MO" onChange={e => setForm({ ...form, recurrence: e.target.value })}/></label>
        <label>参与人<input value={form.attendees} placeholder="邮箱或 ou_ 开头的 open_id，逗号分隔" onChange={e => setForm({ ...form, attendees: e.target.value })}/></label>
        <label>附件<input value={form.attachments} placeholder="飞书 file_token，逗号分隔（需先上传）" onChange={e => setForm({ ...form, attachments: e.target.value })}/></label>
        <label className={styles.calendarDescription}>描述<textarea value={form.description} maxLength={400} placeholder="可选；批准后会附上操作标记" onChange={e => setForm({ ...form, description: e.target.value })}/></label>
        <div className={styles.calendarFoot}><small>时区 {zone}；提交只生成待确认提案，不会直接写入飞书。</small><button className="workspace-tool focus-ring" disabled={!ready}>{saving ? "正在冻结提案…" : "生成待确认提案"}</button></div>
      </>}
  </form>;
}
