"use client";
import { useRef, useState, type FormEvent } from "react";
import { MaterialInput } from "./MaterialInput";
import styles from "./V2DelegationStarter.module.css";

export function MissionMaterialForm({ missionId, projectId, onSaved }: { missionId: string; projectId: string; onSaved: () => Promise<void> }) {
  const [open, setOpen] = useState(false), [text, setText] = useState(""), [name, setName] = useState<string | undefined>();
  const [kind, setKind] = useState<"MATERIAL" | "FEEDBACK">("FEEDBACK");
  const [busy, setBusy] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const request = useRef<{ requestId: string; text: string; name?: string; kind: typeof kind } | null>(null);
  const [reading, setReading] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy || reading || !text.trim()) return;
    setBusy(true); setError(""); setMessage("");
    request.current ??= { requestId: crypto.randomUUID(), text, ...(name ? { name } : {}), kind };
    setPending(true);
    try {
      const response = await fetch("/api/missions/" + encodeURIComponent(missionId) + "/materials", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request.current),
      });
      const value = await response.json();
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) { request.current = null; setPending(false); }
        throw new Error(value.error?.message ?? "材料保存未确认，请重试原请求");
      }
      request.current = null; setPending(false); setText(""); setName(undefined);
      setMessage("材料已保存，原委托会按现有许可核对；反馈仍是待核对意见。");
      await onSaved();
      setOpen(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存未确认，请重试原请求"); }
    finally { setBusy(false); }
  }
  return <section className={styles.materialSection} aria-label="补充项目材料">
    <button className="editorial-button-secondary" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>补充材料或反馈</button>
    {open && <form className={styles.form} onSubmit={event => void submit(event)}>
      <label>材料用途<select value={kind} disabled={busy || pending} onChange={event => setKind(event.target.value as typeof kind)}>
        <option value="FEEDBACK">反馈意见（待核对）</option><option value="MATERIAL">新项目资料</option>
      </select></label>
      <MaterialInput projectId={projectId} label="补充内容" value={text} name={name} disabled={busy || pending} onReadingChange={setReading} onChange={(value, fileName) => { setText(value); setName(fileName); }} />
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <div><button className="editorial-button" type="submit" disabled={busy || reading || !text.trim()}>{busy ? "正在保存…" : pending ? "重试原材料" : "保存到原项目"}</button></div>
    </form>}
    {message && <p role="status" className={styles.note}>{message}</p>}
  </section>;
}
