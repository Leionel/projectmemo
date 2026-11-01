"use client";
import { useEffect, useRef, useState } from "react";
import type { ClaimCommand, ClaimControlsView, ClaimHeadView, ClaimTextView } from "@/lib/types/agentMemory";
import { clearConversationDraft, readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";
import { OverlayPanel } from "./OverlayPanel";
import styles from "./ConversationPanel.module.css";

async function request<T>(url: string, body?: ClaimCommand): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "暂时无法核对纠正"), { status: response.status });
  return result;
}

/** Controlled correction dialog for the message toolbar: entry stays in the toolbar, this only renders the panel. */
export function CorrectionDialog({ open, onClose, projects, sourceId, onChanged }: {
  open: boolean; onClose: () => void; projects: Array<{ id: string; title: string }>; sourceId: string; onChanged: () => void;
}) {
  if (!open) return null;
  return <OverlayPanel onClose={onClose} label="纠正对这条回答的理解" title="纠正理解">
    <CorrectionPicker projects={projects} sourceId={sourceId} onChanged={onChanged}/>
  </OverlayPanel>;
}
function CorrectionPicker({ projects, sourceId, onChanged }: {
  projects: Array<{ id: string; title: string }>; sourceId: string; onChanged: () => void;
}) {
  const [selected, setSelected] = useState(projects.length === 1 ? projects[0].id : "");
  const projectId = projects.length > 1 ? selected : projects[0]?.id ?? "";
  return <>
    {projects.length > 1 && <label className={styles.field}>纠正适用的项目
      <select value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">选择项目</option>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select></label>}
    {projects.length > 1 && !selected
      ? <p className={styles.panelNote}>先选择纠正适用的项目；纠正只影响你在该项目中的后续理解。</p>
      : <ClaimCorrectionBody key={projectId + sourceId} projectId={projectId}
        kind="MESSAGE" sourceId={sourceId} onChanged={onChanged}/>}
  </>;
}

/** Standalone entry (memory/hypothesis panels): same quiet action, edit surface in a panel. */
export function ClaimCorrection({ projectId, kind, sourceId, onChanged }: {
  projectId: string; kind: ClaimTextView["kind"]; sourceId: string; onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className={styles.correctionEntry + " focus-ring"} aria-expanded={open}
      onClick={() => setOpen(true)}>纠正理解</button>
    {open && <OverlayPanel onClose={() => setOpen(false)} label="纠正理解" title="纠正理解">
      <ClaimCorrectionBody projectId={projectId} kind={kind} sourceId={sourceId} onChanged={onChanged}/>
    </OverlayPanel>}
  </>;
}

/** Exact raw text selection; rendered Markdown offsets never become source offsets. */
function ClaimCorrectionBody({ projectId, kind, sourceId, onChanged }: {
  projectId: string; kind: ClaimTextView["kind"]; sourceId: string; onChanged?: () => void;
}) {
  const key = `claim:${projectId}:${kind}:${sourceId}`, endpoint = `/api/projects/${encodeURIComponent(projectId)}/agent-claims`;
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [text, setText] = useState<ClaimTextView | null>(null), [controls, setControls] = useState<ClaimControlsView | null>(null);
  const [quote, setQuote] = useState(() => readConversationDraft(key).answer), [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [pending, setPending] = useState<ClaimCommand | null>(() => {
    try { return JSON.parse(readConversationDraft(key).claimRequest ?? "null"); } catch { return null; }
  });
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind, sourceId]);
  async function load() {
    const token = ++epoch.current; setBusy(true); setError("");
    try {
      const state = await request<ClaimControlsView>(endpoint);
      const source = await request<ClaimTextView>(`${endpoint}?kind=${kind}&sourceId=${encodeURIComponent(sourceId)}`).catch(() => null);
      if (token !== epoch.current) return;
      setText(source); setControls(state); if (!source) setError("原内容暂不可读；仍可核对已保存的纠正或原次提交"); setSelection([0, 0]);
    } catch (e) { if (token === epoch.current) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { if (token === epoch.current) setBusy(false); }
  }
  async function submit(withdraw?: ClaimHeadView) {
    if (!controls || (!text && !pending && !withdraw)) return;
    const [start, end] = selection;
    if (!withdraw && !pending && (start === end || end - start > 6000 || !quote.trim())) { setError("请在原文中选择需要纠正的部分，并说明应怎样理解"); return; }
    const origin = withdraw?.origin ?? { kind, id: sourceId, contentHash: text!.contentHash, offsetEncoding: "UTF16_CODE_UNITS" as const,
      normalization: "RAW_V1" as const, start, end, quote: text!.text.slice(start, end) };
    const head = controls.heads.find(h => h.origin.kind === origin.kind && h.origin.id === origin.id && h.origin.contentHash === origin.contentHash && h.origin.start === origin.start && h.origin.end === origin.end);
    const body: ClaimCommand = pending ?? { requestId: crypto.randomUUID(), scope: { projectId }, expectedSeq: controls.seq, expectedOwnerUserId: controls.ownerUserId, origin,
      operation: withdraw ? "WITHDRAW" : "CORRECT", ...(withdraw || head ? { expectedRevision: (withdraw ?? head)!.revision } : {}),
      ...(!withdraw ? { userQuote: quote.trim() } : {}) };
    saveConversationDraft(key, { ...readConversationDraft(key), claimRequest: JSON.stringify(body) }); setPending(body); setBusy(true); setError(""); const token = epoch.current;
    try {
      await request(endpoint, body); if (token !== epoch.current) return; clearConversationDraft(key); setPending(null); setQuote(""); onChanged?.(); await load();
    } catch (e) {
      if (token !== epoch.current) return;
      if ((e as { status?: number }).status && (e as { status: number }).status < 500) {
        saveConversationDraft(key, { ...readConversationDraft(key), claimRequest: "" }); setPending(null);
      }
      setError(e instanceof Error ? e.message : "尚未确认保存结果，请核对原请求");
    } finally { if (token === epoch.current) setBusy(false); }
  }
  return <div className={styles.claimBody}>
    <p className={styles.panelNote}>用于我在这个项目中的后续理解，原记录保留。</p>
    {text && <label className={styles.field}>需要纠正的原文（拖选其中一段）
      <textarea aria-label="选择需要纠正的原文" className={styles.claimSource} readOnly value={text.text} rows={5}
        onSelect={e => setSelection([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}/></label>}
    {text && (selection[1] > selection[0]
      ? <p className={styles.selectionQuote}>已选择：「{text.text.slice(selection[0], selection[1])}」</p>
      : <p className={styles.panelNote}>尚未选择原文片段。</p>)}
    <label className={styles.field}>应该如何理解
      <textarea aria-label="应怎样理解" value={quote} maxLength={2000} disabled={busy || !!pending} rows={3}
        onChange={e => { setQuote(e.target.value); saveConversationDraft(key, { ...readConversationDraft(key), answer: e.target.value }); }}/></label>
    <div className={styles.dialogActions}>
      <button className="editorial-button focus-ring" disabled={busy || !controls} onClick={() => void submit()}>{pending ? "核对原次提交" : "保存纠正"}</button>
      <button className="workspace-tool focus-ring" disabled={busy} onClick={() => void load()}>重新核对</button>
    </div>
    {pending && <p className={styles.panelNote} role="status">上次提交结果未确认，保存将核对原次提交。</p>}
    {!!controls?.heads.filter(h => h.origin.kind === kind && h.origin.id === sourceId).length && <div className={styles.claimHistory}>
      <p className={styles.historyTitle}>纠正历史</p>
      {controls.heads.filter(h => h.origin.kind === kind && h.origin.id === sourceId).map(h => <div key={h.claimId} className={styles.claimHead}>
        <blockquote>{h.origin.quote}</blockquote><p>{h.userQuote}</p>
        <div className={styles.claimHeadFoot}><span>{h.active ? "当前纠正" : "历史纠正"}</span>
          {h.active && <button disabled={busy || !!pending} className="workspace-link focus-ring" onClick={() => void submit(h)}>撤回这次纠正</button>}</div>
      </div>)}
    </div>}
    {busy && <p className={styles.panelNote} role="status">正在核对原记录…</p>}
    {error && <p role="alert" className={styles.claimError}>{error}</p>}
  </div>;
}
