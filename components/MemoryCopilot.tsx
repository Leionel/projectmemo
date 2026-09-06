"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, Check, ChevronDown, CircleAlert, LoaderCircle, Send } from "lucide-react";
import type {
  AgentChatResponse,
  AgentCitation,
  EvidenceSupportState,
  EvidenceTrustReceipt,
  ProposedAction,
} from "@/lib/types";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type Message = {
  id?: string;
  runId?: string | null;
  role: "USER" | "ASSISTANT";
  content: string;
  citations: AgentCitation[];
  proposedActions: ProposedAction[];
  trustReceipt?: EvidenceTrustReceipt;
};

const receiptMeta: Record<EvidenceSupportState, { label: string; className: string }> = {
  SUPPORTED: { label: "依据充分", className: "border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" },
  CONTESTED: { label: "存在冲突", className: "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200" },
  INSUFFICIENT: { label: "证据不足", className: "border-rose-300/60 bg-rose-50 text-rose-800 dark:border-rose-700 dark:bg-rose-950/40 dark:text-rose-300" },
};

function Receipt({ receipt, citations }: { receipt: EvidenceTrustReceipt; citations: AgentCitation[] }) {
  const meta = receiptMeta[receipt.supportState];
  const citationById = new Map(citations.map((citation) => [citation.cardId, citation]));
  return <div className="mt-3">
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.className}`} aria-label={`证据支持状态：${meta.label}`}>
      {receipt.supportState !== "SUPPORTED" && <CircleAlert size={12} aria-hidden="true" />}{meta.label}
    </span>
    <details className="mt-2 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-3 py-2">
      <summary className="focus-ring cursor-pointer rounded text-xs font-black text-[var(--navy)]">查看证据回执与原始卡片</summary>
      <div className="mt-2 space-y-2 text-xs leading-5 text-[var(--ink-soft)]">
        <p>检索方式：{receipt.retrievalMode === "hybrid" ? "混合检索" : receipt.retrievalMode === "keyword_fallback" ? "关键词降级" : receipt.retrievalMode === "semantic_only" ? "语义检索" : "未检索到证据"}</p>
        {receipt.claims.map((claim, index) => <div key={`${claim.text}-${index}`} className="rounded-md bg-[var(--paper)] p-2.5">
          <p className="font-bold text-[var(--navy)]">结论 {index + 1} · {receiptMeta[claim.support].label}</p>
          <p className="mt-1">{claim.text}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {claim.cardIds.map((cardId) => <a key={cardId} href={`#card-${cardId}`} className="focus-ring rounded bg-[var(--paper-strong)] px-2 py-0.5 font-bold text-[var(--teal-strong)]">当前卡片：{citationById.get(cardId)?.title ?? cardId}</a>)}
            {claim.supersededCardIds.map((cardId) => <a key={cardId} href={`#card-${cardId}`} className="focus-ring rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">历史卡片：{citationById.get(cardId)?.title ?? cardId}</a>)}
            {claim.cardIds.length === 0 && claim.supersededCardIds.length === 0 && <span className="font-semibold text-[var(--brick)]">没有可核验卡片</span>}
          </div>
        </div>)}
        {receipt.refusalReason && <p className="font-semibold text-[var(--brick)]">拒答原因：{receipt.refusalReason}</p>}
      </div>
    </details>
  </div>;
}

export function MemoryCopilot({ projectId }: { projectId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [open, setOpen] = useState(() => searchParams.get("openCopilot") === "1");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [toolBusy, setToolBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackHref, setFeedbackHref] = useState("");

  useEffect(() => {
    const openFromHash = () => { if (window.location.hash === "#memory-copilot") setOpen(true); };
    const openFromShortcut = () => setOpen(true);
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    window.addEventListener("projectmemo:open-copilot", openFromShortcut);
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      window.removeEventListener("projectmemo:open-copilot", openFromShortcut);
    };
  }, []);

  useEffect(() => {
    if (!open || messages.length) return;
    fetch(`/api/projects/${projectId}/agent/chat`).then((response) => response.json()).then((data) => {
      setMessages((data.messages ?? []).map((item: Message) => ({
        ...item,
        citations: item.citations ?? [],
        proposedActions: item.proposedActions ?? [],
      })));
    }).catch(() => undefined);
  }, [messages.length, open, projectId]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || loading) return;
    const text = question.trim();
    setQuestion("");
    setLoading(true);
    setFeedback("");
    setMessages((old) => [...old, { role: "USER", content: text, citations: [], proposedActions: [] }]);
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "问答失败，请稍后重试");
      const answer = data as AgentChatResponse;
      setMessages((old) => [...old, {
        role: "ASSISTANT",
        runId: answer.runId,
        content: answer.message,
        citations: answer.citations ?? [],
        proposedActions: answer.proposedActions ?? [],
        trustReceipt: answer.trustReceipt,
      }]);
      if (answer.fallback) setFeedback("当前使用本地确定性回答，证据仍由服务器逐条校验。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "问答失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  async function confirmTool(action: ProposedAction, sourceRunId?: string | null) {
    setToolBusy(action.title);
    setFeedback("");
    setFeedbackHref("");
    const payload = action.kind === "generate_artifact"
      ? { artifactType: action.artifactType }
      : { title: action.title, description: action.description, priority: action.priority };
    try {
      const response = await fetch(`/api/projects/${projectId}/agent/tools`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: action.kind, confirmed: true, sourceRunId, payload }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "执行操作失败");
      if (action.kind === "create_action") {
        setFeedback("已创建行动项。");
        setFeedbackHref("#action-board");
        emitWorkspaceChange(projectId, ["actions", "metrics", "projects"]);
      } else {
        setFeedback("已生成成果草稿。");
        setFeedbackHref(`/projects/${projectId}/generate?type=${action.artifactType ?? "competition_outline"}`);
        emitWorkspaceChange(projectId, ["artifacts", "interventions", "metrics", "projects"]);
      }
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "执行操作失败");
    } finally {
      setToolBusy("");
    }
  }

  return <section id="memory-copilot" className="card-surface scroll-mt-24 overflow-hidden rounded-[1.5rem]">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="focus-ring flex w-full items-center justify-between gap-3 p-5 text-left sm:p-6">
      <span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--navy)] text-white"><Bot size={20} /></span><span><span className="block text-sm font-black text-[var(--navy)]">问忆程</span><span className="mt-0.5 block text-xs text-[var(--ink-soft)]">逐条核验依据；证据不足或冲突时不会执行写操作</span></span></span>
      <ChevronDown size={18} className={`transition ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="border-t archive-rule p-5 sm:p-6">
      <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
        {messages.length ? messages.map((item, index) => <div key={item.id ?? index} className={`rounded-xl p-3 text-sm leading-6 ${item.role === "USER" ? "ml-8 bg-[var(--paper)] text-[var(--navy)]" : "mr-4 bg-[var(--paper-strong)] text-[var(--ink-soft)]"}`}>
          <p className="whitespace-pre-wrap">{item.content}</p>
          {item.role === "ASSISTANT" && item.trustReceipt && <Receipt receipt={item.trustReceipt} citations={item.citations} />}
          {!item.trustReceipt && item.citations.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{item.citations.map((citation) => <a key={citation.cardId} href={`#card-${citation.cardId}`} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">引用：{citation.title}</a>)}</div>}
          {item.proposedActions.length > 0 && <div className="mt-3 space-y-2">{item.proposedActions.map((action) => <div key={action.title} className="rounded-lg border border-[var(--teal)]/30 bg-[var(--teal-pale)] p-2.5"><p className="text-xs font-bold text-[var(--navy)]">{action.title}</p><button type="button" onClick={() => void confirmTool(action, item.runId)} disabled={Boolean(toolBusy)} className="focus-ring mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-black text-[var(--teal-strong)] disabled:opacity-60">{toolBusy === action.title ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}确认执行</button></div>)}</div>}
        </div>) : <p className="rounded-xl bg-[var(--paper-strong)] p-5 text-center text-sm text-[var(--ink-soft)]">试试问“当前进展如何？”或“消融实验完成了吗？”</p>}
        {loading && <div className="mr-4 rounded-xl bg-[var(--paper-strong)] p-3 text-sm text-[var(--muted)]"><LoaderCircle size={15} className="mr-2 inline animate-spin" />正在检索并核验证据…</div>}
      </div>
      {feedback && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{feedback}{feedbackHref && <a href={feedbackHref} className="ml-2 underline underline-offset-3">立即查看 →</a>}</p>}
      <form onSubmit={ask} className="mt-4 flex gap-2"><input aria-label="问项目进展、提醒依据或下一步" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={loading} className="focus-ring editorial-input min-w-0 flex-1 px-3 py-2.5 text-sm" placeholder="问项目进展、提醒依据或下一步" /><button type="submit" disabled={loading || !question.trim()} className="focus-ring editorial-button disabled:opacity-50"><Send size={16} />发送</button></form>
    </div>}
  </section>;
}
