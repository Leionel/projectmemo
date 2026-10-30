"use client";
import { useEffect, useRef, useState } from "react";
import type { ClaimCommand, ClaimControlsView, ClaimHeadView, ClaimTextView } from "@/lib/types/agentMemory";
import { clearConversationDraft, readConversationDraft, saveConversationDraft } from "@/lib/client/conversationDrafts";

export function ScopedMessageCorrection({ sourceId, projects, onChanged }: { sourceId: string; projects: Array<{ id: string; title: string }>; onChanged: () => void }) {
  const [selected, setSelected] = useState(projects.length === 1 ? projects[0].id : "");
  const projectId = projects.some(p => p.id === selected) ? selected : "";
  return <>
    {projects.length > 1 && <label>纠正适用的项目 <select value={projectId} onChange={e => setSelected(e.target.value)}><option value="">选择项目</option>{projects.map(p=><option key={p.id} value={p.id}>{p.title}</option>)}</select></label>}
    {projectId && <ClaimCorrection key={projectId + sourceId} projectId={projectId} kind="MESSAGE" sourceId={sourceId} onChanged={onChanged}/>}
  </>;
}

async function request<T>(url: string, body?: ClaimCommand): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25000) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error?.message ?? "暂时无法核对纠正"), { status: response.status });
  return result;
}
/** Exact raw text selection; rendered Markdown offsets never become source offsets. */
export function ClaimCorrection({ projectId, kind, sourceId, onChanged }: {
  projectId: string; kind: ClaimTextView["kind"]; sourceId: string; onChanged?: () => void;
}) {
  const key = `claim:${projectId}:${kind}:${sourceId}`, endpoint = `/api/projects/${encodeURIComponent(projectId)}/agent-claims`;
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [text, setText] = useState<ClaimTextView | null>(null), [controls, setControls] = useState<ClaimControlsView | null>(null);
  const [quote, setQuote] = useState(() => readConversationDraft(key).answer), [selection, setSelection] = useState<[number, number]>([0, 0]);
  const [pending, setPending] = useState<ClaimCommand | null>(() => {
    try { return JSON.parse(readConversationDraft(key).claimRequest ?? "null"); } catch { return null; }
  });
  const epoch = useRef(0);
  useEffect(() => () => { epoch.current++; }, []);
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
  return <details open={open} onToggle={e => { const next = e.currentTarget.open; setOpen(next); if (next && !controls && !busy) void load(); }}>
    <summary>纠正理解</summary>
    {open && <div>
      <p>用于我在这个项目中的后续理解，原记录保留。</p>
      {text && <label>选择需要纠正的原文<textarea aria-label="选择需要纠正的原文" readOnly value={text.text} rows={5}
        onSelect={e => setSelection([e.currentTarget.selectionStart, e.currentTarget.selectionEnd])}/></label>}
      <label>应怎样理解<textarea aria-label="应怎样理解" value={quote} maxLength={2000} disabled={busy || !!pending}
        onChange={e => { setQuote(e.target.value); saveConversationDraft(key, { ...readConversationDraft(key), answer: e.target.value }); }}/></label>
      <button disabled={busy || !controls} onClick={() => void submit()}>{pending ? "核对原次提交" : "保存纠正"}</button>
      <button disabled={busy} onClick={() => void load()}>重新核对</button>
      {controls?.heads.filter(h => h.origin.kind === kind && h.origin.id === sourceId).map(h => <div key={h.claimId}>
        <blockquote>{h.origin.quote}</blockquote><p>{h.userQuote}</p><span>{h.active ? "当前纠正" : "历史纠正"}</span>
        {h.active && <button disabled={busy || !!pending} onClick={() => void submit(h)}>撤回这次纠正</button>}
      </div>)}
      {busy && <p role="status">正在核对原记录…</p>}{error && <p role="alert">{error}</p>}
    </div>}
  </details>;
}
