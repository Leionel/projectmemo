"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Bot, Check, ChevronDown, LoaderCircle, Send } from "lucide-react";
import type { AgentChatResponse, AgentCitation, ProposedAction } from "@/lib/types";
import { emitWorkspaceChange } from "@/lib/client/workspaceEvents";

type Message = { id?: string; role: "USER" | "ASSISTANT"; content: string; citations: AgentCitation[]; proposedActions: ProposedAction[] };

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
    const openFromHash = () => {
      if (window.location.hash === "#memory-copilot") setOpen(true);
    };
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
    fetch("/api/projects/" + projectId + "/agent/chat").then((response) => response.json()).then((data) => {
      setMessages((data.messages ?? []).map((item: Message & { citations?: AgentCitation[]; proposedActions?: ProposedAction[] }) => ({ ...item, citations: item.citations ?? [], proposedActions: item.proposedActions ?? [] })));
    }).catch(() => undefined);
  }, [messages.length, open, projectId]);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || loading) return;
    const text = question.trim();
    setQuestion(""); setLoading(true); setFeedback("");
    setMessages((old) => [...old, { role: "USER", content: text, citations: [], proposedActions: [] }]);
    try {
      const response = await fetch("/api/projects/" + projectId + "/agent/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: text }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "问答失败，请稍后重试");
      const answer = data as AgentChatResponse;
      setMessages((old) => [...old, { role: "ASSISTANT", content: answer.message, citations: answer.citations ?? [], proposedActions: answer.proposedActions ?? [] }]);
      if (answer.fallback) setFeedback("当前使用离线 mock 回答；仍然只引用项目内存。");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "问答失败，请稍后重试");
    } finally { setLoading(false); }
  }

  async function confirmTool(action: ProposedAction) {
    setToolBusy(action.title); setFeedback(""); setFeedbackHref("");
    const payload = action.kind === "generate_artifact" ? { artifactType: action.artifactType } : { title: action.title, description: action.description, priority: action.priority };
    try {
      const response = await fetch("/api/projects/" + projectId + "/agent/tools", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: action.kind, confirmed: true, payload }) });
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
    } catch (error) { setFeedback(error instanceof Error ? error.message : "执行操作失败"); } finally { setToolBusy(""); }
  }

  return <section id="memory-copilot" className="card-surface scroll-mt-24 overflow-hidden rounded-[1.5rem]"><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="focus-ring flex w-full items-center justify-between gap-3 p-5 text-left sm:p-6"><span className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--navy)] text-white"><Bot size={20} /></span><span><span className="block text-sm font-black text-[var(--navy)]">问忆程</span><span className="mt-0.5 block text-xs text-[var(--ink-soft)]">总结进展、解释提醒、检索历史记忆，写操作都需要确认</span></span></span><ChevronDown size={18} className={"transition " + (open ? "rotate-180" : "")} /></button>
    {open && <div className="border-t archive-rule p-5 sm:p-6"><div className="max-h-80 space-y-3 overflow-y-auto pr-1">{messages.length ? messages.map((item, index) => <div key={item.id ?? index} className={"rounded-xl p-3 text-sm leading-6 " + (item.role === "USER" ? "ml-8 bg-[var(--paper)] text-[var(--navy)]" : "mr-4 bg-[var(--paper-strong)] text-[var(--ink-soft)]")}><p className="whitespace-pre-wrap">{item.content}</p>{item.citations.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{item.citations.map((citation) => <a key={citation.cardId} href={"#card-" + citation.cardId} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-[11px] font-bold text-[var(--teal-strong)]">引用：{citation.title}</a>)}</div>}{item.proposedActions.length > 0 && <div className="mt-3 space-y-2">{item.proposedActions.map((action) => <div key={action.title} className="rounded-lg border border-[var(--teal)]/30 bg-[var(--teal-pale)] p-2.5"><p className="text-xs font-bold text-[var(--navy)]">{action.title}</p><button type="button" onClick={() => void confirmTool(action)} disabled={Boolean(toolBusy)} className="focus-ring mt-2 inline-flex items-center gap-1 rounded-md bg-[var(--paper-strong)] px-2 py-1 text-[11px] font-black text-[var(--teal-strong)] disabled:opacity-60">{toolBusy === action.title ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}确认执行</button></div>)}</div>}</div>) : <p className="rounded-xl bg-[var(--paper-strong)] p-5 text-center text-sm text-[var(--ink-soft)]">试试问“当前进展如何？”或“为什么提醒我处理风险？”</p>}{loading && <div className="mr-4 rounded-xl bg-[var(--paper-strong)] p-3 text-sm text-[var(--muted)]"><LoaderCircle size={15} className="mr-2 inline animate-spin" />Agent 正在检索项目记忆…</div>}</div>
      {feedback && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{feedback}{feedbackHref && <a href={feedbackHref} className="ml-2 underline underline-offset-3">立即查看 →</a>}</p>}
      <form onSubmit={ask} className="mt-4 flex gap-2"><input aria-label="问项目进展、提醒依据或下一步" value={question} onChange={(event) => setQuestion(event.target.value)} disabled={loading} className="focus-ring editorial-input min-w-0 flex-1 px-3 py-2.5 text-sm" placeholder="问项目进展、提醒依据或下一步" /><button type="submit" disabled={loading || !question.trim()} className="focus-ring editorial-button disabled:opacity-50"><Send size={16} />发送</button></form>
    </div>}
  </section>;
}
