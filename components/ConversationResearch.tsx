"use client";
import { useState } from "react";
import type { ConversationView, ConversationMessage } from "@/lib/types/conversation";

async function request<T>(url: string, method: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const value = await response.json(); if (!response.ok) throw new Error(value.error?.message ?? "研究范围未保存"); return value;
}
export function ConversationResearchScope({ view, projectId, disabled, onChange, onError }: {
  view: ConversationView; projectId: string; disabled: boolean; onChange: (view: ConversationView) => void; onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false), [topic, setTopic] = useState(""), [terms, setTerms] = useState(""), [hosts, setHosts] = useState(""), [saving, setSaving] = useState(false);
  const [academic,setAcademic]=useState(false);
  const research = view.research;
  if (!research?.available) return null;
  async function save(enabled: boolean) {
    if (!research) return;
    setSaving(true);
    try {
      const next = await request<NonNullable<ConversationView["research"]>>(`/api/conversations/${view.id}/research-scope`, "PATCH", {
        expectedRevision: research.revision, projectId: projectId || research.projectId || view.homeProjectId,
        scope: enabled ? { academicMetadata:academic,enabled: true, topic: topic.trim(), publicTerms: terms.split(/[,，\n]/).map(s => s.trim()).filter(Boolean),
          allowedHosts: hosts.split(/[,，\n]/).map(s => s.trim().toLowerCase()).filter(Boolean), excludedTerms: [], allowedCategories: ["PUBLIC_TOPIC", "PUBLIC_SOURCE"] }
          : { ...research.scope, enabled: false },
      });
      // A changed grant invalidates prior web material immediately, including cached prose and UI blocks.
      onChange({ ...view, research: next, messages: view.messages.map(message => message.sources.some(source => source.external)
        ? { ...message, content: "来源权限已变化，正在读取当前状态", restricted: true, sources: [], citations: [], fileGuides: [], refs: [], priorities: [],
          proposal: null, presentation: undefined, presentationPlan: undefined, researchCoverage: undefined } : message) });
      setOpen(false);
      const current = await request<ConversationView>(`/api/conversations/${view.id}`, "GET", undefined); onChange(current);
    } catch (e) { onError(e instanceof Error ? e.message : "研究范围未保存"); } finally { setSaving(false); }
  }
  return <div>
    <button type="button" className="workspace-link focus-ring" disabled={disabled || saving} aria-expanded={open} onClick={() => {
      setAcademic(research!.scope.academicMetadata===true); setTopic(research!.scope.topic); setTerms(research!.scope.publicTerms.join("，")); setHosts(research!.scope.allowedHosts.join("，")); setOpen(v => !v);
    }}>{research.scope.enabled ? "联网研究 ✓" : "联网研究"}</button>
    {open && <section role="group" aria-label="公开研究范围" className="my-3 grid gap-3 rounded-xl border border-current/10 p-4">
      <label>公开主题<input className="workspace-input" value={topic} maxLength={300} onChange={e => setTopic(e.target.value)}/></label>
      <label>允许外发的公开概念<input className="workspace-input" value={terms} placeholder="用逗号分隔" onChange={e => setTerms(e.target.value)}/></label>
      <label>限定域名（可选）<input className="workspace-input" value={hosts} placeholder="例如 arxiv.org，github.com" onChange={e => setHosts(e.target.value)}/></label>
      <label><input type="checkbox" checked={academic} onChange={e=>setAcademic(e.target.checked)}/>允许向 Crossref 发送已定位的公开 DOI，读取论文元数据与摘要（非全文）</label>
      <p className="text-sm">搜索仅发送以上公开范围。项目私聊和未公开实验值不作为搜索词；读取你贴的公开链接无需先搜索。</p>
      <div className="flex gap-4"><button type="button" className="workspace-link" disabled={saving || !topic.trim() || !terms.trim() || !(projectId || research.projectId || view.homeProjectId)} onClick={() => void save(true)}>确认范围</button>
        {research.scope.enabled && <button type="button" className="workspace-link" disabled={saving} onClick={() => void save(false)}>关闭联网</button>}
        <button type="button" className="workspace-link" onClick={() => setOpen(false)}>取消</button></div>
    </section>}
  </div>;
}
export function ConversationResearchView({ message, onContinue, conversationId, version, onError }: {
  message: ConversationMessage; onContinue: (text: string) => void; conversationId: string; version: number; onError: (message: string) => void;
}) {
  const coverage = message.researchCoverage;
  const [draft, setDraft] = useState<{ previewHash: string; content: string; projectId: string } | null>(null), [receipt, setReceipt] = useState("");
  if (!message.sources.some(s => s.external) && !coverage) return null;
  async function summarize(confirm = false) {
    try {
      const reply = await request<{ previewHash: string; content: string; projectId: string; artifactId?: string }>(`/api/conversations/${conversationId}/messages/${message.id}/research-summary`, "POST", {
        action: confirm ? "CONFIRM" : "PREVIEW", expectedConversationVersion: version, ...(confirm && draft ? { previewHash: draft.previewHash } : {}),
      });
      if (reply.artifactId) { setReceipt("研究总结已归入项目，来源与适用条件已保留"); setDraft(null); } else setDraft(reply);
    } catch (e) { onError(e instanceof Error ? e.message : "研究总结未保存"); }
  }
  const labels: Record<string, string> = { UNSEEN: "尚未查到", SUMMARY_ONLY: "仅摘要", PARTIAL: "部分依据", READ_SUFFICIENT: "已读相关依据", CONFLICTED: "存在冲突", UNAVAILABLE: "资料不可读", UNKNOWN: "尚不明确" };
  return <section className="my-4 space-y-3" aria-label="本次研究结果">
    {!!coverage?.facets.length && <details><summary className="cursor-pointer text-sm font-medium">调查覆盖与缺口</summary><div className="mt-3 space-y-3">{coverage.facets.map(f => <div key={f.id}>
      <p><strong>{f.question}</strong> · {labels[f.coverage]}</p>
      {f.missing.map((s, i) => <p key={i} className="text-sm">待核对：{s}</p>)}{f.conflicts.map((s, i) => <p key={i} className="text-sm">来源冲突：{s.claim}</p>)}
    </div>)}</div></details>}
    <div className="flex flex-wrap gap-4 text-sm">
      <button type="button" className="workspace-link" onClick={() => onContinue("请根据这条回答的研究缺口继续调查；只有新信息可能改变建议时才联网。")}>继续调查</button>
      <button type="button" className="workspace-link" onClick={() => onContinue("请结合原来源说明为什么推荐这个方案，以及适用条件和反面证据。")}>为什么这样建议</button>
      <button type="button" className="workspace-link" onClick={() => onContinue("请将这条研究结论转成项目验证提案，沿用已有委托或行动，先预览供我确认。")}>准备验证</button>
      <button type="button" className="workspace-link" onClick={() => void summarize()}>保存研究总结</button>
    </div>
    {draft && <div role="group" aria-label="研究总结预览" className="rounded-xl border border-current/10 p-4">
      <p className="mb-3 text-sm">确认后项目成员可见；保留来源、适用条件与未知。</p><pre className="whitespace-pre-wrap font-sans text-sm leading-6">{draft.content}</pre>
      <div className="mt-3 flex gap-4"><button type="button" className="workspace-link" onClick={() => void summarize(true)}>确认归入项目</button><button type="button" className="workspace-link" onClick={() => setDraft(null)}>取消</button></div>
    </div>}{receipt && <p role="status" className="text-sm">{receipt}</p>}
  </section>;
}
