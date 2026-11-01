"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Plus, ShieldCheck, Trash2 } from "lucide-react";

type PersonalEntry = {
  claimId: string; kind: string; statement: string; status: string;
  revision: number; contentHash: string; conditions: { topics: string[]; expiresAt: string | null };
  updatedAt: string;
};

type Policy = {
  useInContextEnabled: boolean; explicitCaptureEnabled: boolean;
  candidateInferenceEnabled: boolean; cloudProcessingEnabled: boolean;
  settingsVersion: number; privacyRevision: number;
} | null;

type Candidate = PersonalEntry & { basis: string };

type Detail = {
  entry: PersonalEntry & { quote: string | null };
  source: { kind: string; description: string; formedAt: string };
  uses: Array<{ kind: string; id: string; at: string; stage: string }>;
  history: Array<{ revision: number; eventKind: string; at: string; quote: string | null }>;
};

const KIND_LABEL: Record<string, string> = { PREFERENCE: "协作偏好", BACKGROUND: "背景信息", FOCUS: "长期关注" };
const STATUS_LABEL: Record<string, string> = { ACTIVE: "使用中", PAUSED: "已暂停", WITHDRAWN: "已撤回", DELETED: "已删除" };

async function callApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(data.error?.message || "请求未完成，请稍后重试");
  return data;
}

function newRequestId(prefix: string): string {
  return prefix + "-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
}

export function PersonalMemoryManager({ displayName }: { displayName: string }) {
  const [entries, setEntries] = useState<PersonalEntry[]>([]);
  const [policy, setPolicy] = useState<Policy>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [quote, setQuote] = useState("");
  const [kind, setKind] = useState("PREFERENCE");
  const [topic, setTopic] = useState("");
  const [includeStopped, setIncludeStopped] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; title: string }>>([]);
  const [candidateBusyId, setCandidateBusyId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editDraft, setEditDraft] = useState("");

  const reload = useCallback(async () => {
    try {
      const data = await callApi<{ items: PersonalEntry[]; policy: Policy }>(`/api/me/memory${includeStopped ? "?includeStopped=1" : ""}`);
      const candidateData = await callApi<{ items: Candidate[] }>("/api/me/memory?candidates=1");
      setEntries(data.items); setPolicy(data.policy); setCandidates(candidateData.items); setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取失败，请稍后重试");
    } finally { setLoading(false); }
  }, [includeStopped]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
    void (async () => {
      try {
        const data = await callApi<{ projects?: Array<{ id: string; title: string }> }>("/api/projects");
        setProjects(data.projects ?? []);
      } catch { /* 项目列表仅用于“仅本项目”选择；失败时该入口降级为不可用 */ }
    })();
  }, [reload]);

  async function confirmCandidate(candidate: Candidate, patch: { confirmedStatement?: string; useScope?: { mode: "ALL" | "PROJECTS"; projectIds?: string[] } }, successNotice: string) {
    if (candidateBusyId !== "") return;
    setCandidateBusyId(candidate.claimId); setError(""); setNotice("");
    try {
      await callApi("/api/me/memory", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: newRequestId("pm-confirm-" + candidate.claimId + "-" + candidate.revision),
          operation: "CONFIRM_CANDIDATE", claimId: candidate.claimId, expectedRevision: candidate.revision,
          frozenContentHash: candidate.contentHash, ...patch }) });
      setNotice(successNotice); setEditingId(""); await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "确认未完成，请稍后重试");
    } finally { setCandidateBusyId(""); }
  }

  async function rejectCandidate(candidate: Candidate) {
    if (candidateBusyId !== "") return;
    setCandidateBusyId(candidate.claimId); setError(""); setNotice("");
    try {
      await callApi("/api/me/memory", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: newRequestId("pm-reject-" + candidate.claimId + "-" + candidate.revision),
          operation: "REJECT_CANDIDATE", claimId: candidate.claimId, expectedRevision: candidate.revision }) });
      setNotice("已拒绝；同类依据不变化时不会重复提议。"); await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作未完成，请稍后重试");
    } finally { setCandidateBusyId(""); }
  }

  async function command(input: Record<string, unknown>, successNotice: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await callApi<{ status?: string; admissionQuestion?: string; admissionReason?: string }>("/api/me/memory", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (result.status === "NOT_SAVED") {
        setNotice(result.admissionQuestion ? `需要澄清：${result.admissionQuestion}` : `未保存：${result.admissionReason ?? "范围不明确"}`);
      } else {
        setNotice(successNotice);
        setQuote(""); setTopic("");
      }
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作未完成，请稍后重试");
    } finally { setBusy(false); }
  }

  async function togglePolicy(patch: Record<string, boolean>, label: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      await callApi("/api/me/memory/policy", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: newRequestId("pm-policy"), ...patch }) });
      setNotice(label); await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "策略未更新，请稍后重试");
    } finally { setBusy(false); }
  }

  async function openDetail(claimId: string) {
    setBusy(true); setError("");
    try { setDetail(await callApi<Detail>(`/api/me/memory?claimId=${encodeURIComponent(claimId)}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "详情读取失败"); }
    finally { setBusy(false); }
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--ink)]">我的记忆</h1>
          <p className="mt-1.5 text-sm leading-6 text-[var(--ink-soft)]">用于你自己的项目协作；只保存你明确提供的非敏感内容，来源与使用随时可查。</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-lg bg-[var(--paper-strong)] px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] sm:inline-flex">
          <ShieldCheck size={14} className="text-[var(--teal-strong)]" />{displayName}
        </span>
      </header>

      <section className="card-surface mt-5 rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-bold text-[var(--ink)]">添加记忆</h2>
        <textarea value={quote} onChange={(event) => setQuote(event.target.value)} rows={2}
          placeholder="例如：以后技术讨论先给结论，再按需要展开。也可以直接写一句像对话一样的话。"
          className="editorial-input mt-3 w-full resize-y text-sm" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={kind} onChange={(event) => setKind(event.target.value)} className="editorial-input min-h-9 w-auto px-3 py-1.5 text-sm" aria-label="条目类别">
            <option value="PREFERENCE">协作偏好</option>
            <option value="BACKGROUND">背景信息</option>
            <option value="FOCUS">长期关注</option>
          </select>
          <input value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="适用主题（可选，如：技术讨论）"
            className="editorial-input min-h-9 w-auto flex-1 px-3 py-1.5 text-sm" aria-label="适用主题" />
          <button type="button" disabled={busy || quote.trim().length === 0}
            onClick={() => void command({ requestId: newRequestId("pm-add"), operation: "ADD_EXPLICIT", quote, kind, ...(topic.trim() ? { topics: [topic.trim()] } : {}) }, "已保存，之后的对话与委托会按当前版本使用。")}
            className="focus-ring editorial-button inline-flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50">
            {busy ? <LoaderCircle size={15} className="animate-spin" /> : <Plus size={15} />}保存
          </button>
          <button type="button" disabled={busy || quote.trim().length === 0}
            onClick={() => void command({ requestId: newRequestId("pm-admit"), operation: "ADD_FROM_EXPRESSION", quote }, "已按你这句话的范围保存。")}
            className="focus-ring rounded-lg px-3 py-2 text-sm font-bold text-[var(--teal-strong)] transition hover:bg-[var(--teal-pale)] disabled:opacity-50">
            按原话判断并保存
          </button>
        </div>
        {notice && <p className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-sm font-semibold text-[var(--ink)]" role="status">{notice}</p>}
        {error && <p className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-sm font-bold text-[var(--brick)]" role="alert">{error}</p>}
      </section>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[var(--ink)]">已记住（{entries.length}）</h2>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ink-soft)]">
            <input type="checkbox" checked={includeStopped} onChange={(event) => setIncludeStopped(event.target.checked)} className="h-3.5 w-3.5" />
            显示已停用
          </label>
        </div>
        {loading ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-[var(--muted)]"><LoaderCircle size={16} className="animate-spin" />正在读取…</p>
        ) : entries.length === 0 ? (
          <p className="card-surface mt-3 rounded-xl p-5 text-sm leading-6 text-[var(--ink-soft)]">还没有保存任何内容。你可以在对话里明确说明一次，或在上面的表单里添加。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {entries.map((entry) => (
              <li key={entry.claimId} className="card-surface rounded-xl p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold leading-6 text-[var(--ink)]">{entry.statement || "（正文已删除）"}</p>
                    <p className="mt-1 text-xs font-semibold text-[var(--muted)]">
                      {KIND_LABEL[entry.kind] ?? entry.kind} · {STATUS_LABEL[entry.status] ?? entry.status}
                      {entry.conditions.topics.length > 0 && ` · 适用：${entry.conditions.topics.join("、")}`}
                      {entry.conditions.expiresAt && ` · 有效期至 ${new Date(entry.conditions.expiresAt).toLocaleDateString("zh-CN")}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-1.5">
                    <button type="button" onClick={() => void openDetail(entry.claimId)} className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--navy)] hover:bg-[var(--paper)]">来源与使用</button>
                    {entry.status === "ACTIVE" && (
                      <button type="button" disabled={busy} onClick={() => void command({ requestId: newRequestId("pm-pause-" + entry.claimId + "-" + entry.revision), operation: "PAUSE", claimId: entry.claimId, expectedRevision: entry.revision }, "已暂停使用；内容保留，模型上下文不再使用。")}
                        className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]">暂停</button>)}
                    {entry.status === "PAUSED" && (
                      <button type="button" disabled={busy} onClick={() => void command({ requestId: newRequestId("pm-resume-" + entry.claimId + "-" + entry.revision), operation: "RESUME", claimId: entry.claimId, expectedRevision: entry.revision }, "已恢复使用。")}
                        className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--teal-strong)] hover:bg-[var(--teal-pale)]">恢复</button>)}
                    {entry.status !== "DELETED" && (
                      <button type="button" disabled={busy} onClick={() => { if (confirm("删除这条记忆？正文会被清除，正在进行中的使用会立即停止。")) void command({ requestId: newRequestId("pm-del-" + entry.claimId + "-" + entry.revision), operation: "DELETE", claimId: entry.claimId, expectedRevision: entry.revision }, "已删除：先停止使用，正文清除完成前会在详情中标示。"); }}
                        className="focus-ring inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--brick)] hover:bg-[var(--brick-pale)]"><Trash2 size={12} />删除</button>)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail && (
        <section className="card-surface mt-5 rounded-xl p-4 sm:p-5" aria-label="条目详情">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-sm font-bold text-[var(--ink)]">条目详情</h2>
            <button type="button" onClick={() => setDetail(null)} className="focus-ring rounded-lg px-2 py-1 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper)]">收起</button>
          </div>
          <p className="mt-2 text-sm font-bold text-[var(--ink)]">{detail.entry.quote ?? (detail.entry.statement || "（正文已删除）")}</p>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-soft)]">来源：{detail.source.description} 形成于 {new Date(detail.source.formedAt).toLocaleString("zh-CN")}。</p>
          <ul className="mt-3 space-y-1.5 text-xs leading-5 text-[var(--ink-soft)]">
            {detail.history.map((item) => (
              <li key={item.revision}>#{item.revision} {item.eventKind} · {new Date(item.at).toLocaleString("zh-CN")}{item.quote ? ` · “${item.quote}”` : ""}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-5 text-[var(--muted)]">使用记录：{detail.uses.length > 0
            ? `最近 ${detail.uses.length} 次进入任务上下文（首次 ${new Date(detail.uses[0].at).toLocaleString("zh-CN")}）。`
            : "还没有进入过任务上下文。"}生成中的任务会在各自“为什么这样建议”里说明引用了哪条记忆。</p>
        </section>
      )}

      {candidates.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-bold text-[var(--ink)]">待确认的理解（{candidates.length}）</h2>
          <ul className="mt-3 space-y-2">
            {candidates.map((candidate) => (
              <li key={candidate.claimId} className="card-surface rounded-xl p-4">
                <p className="text-sm font-bold leading-6 text-[var(--ink)]">{candidate.statement}</p>
                <p className="mt-1 text-xs leading-5 text-[var(--muted)]">依据：{candidate.basis}{candidate.conditions.topics.length > 0 && ` · 适用：${candidate.conditions.topics.join("、")}`}</p>
                {editingId === candidate.claimId && (
                  <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} rows={2}
                    className="editorial-input mt-2 w-full text-sm" aria-label="编辑候选表述" />
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <button type="button" disabled={candidateBusyId === candidate.claimId}
                    onClick={() => void confirmCandidate(candidate, {}, "已按候选范围记住，之后的协作会使用。")}
                    className="focus-ring rounded-lg bg-[var(--teal-pale)] px-3 py-1.5 text-xs font-bold text-[var(--teal-strong)] disabled:opacity-50">按这个范围记住</button>
                  {editingId === candidate.claimId ? (
                    <button type="button" disabled={candidateBusyId === candidate.claimId || editDraft.trim().length === 0}
                      onClick={() => void confirmCandidate(candidate, { confirmedStatement: editDraft.trim() }, "已按你修改后的表述记住。")}
                      className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--navy)] hover:bg-[var(--paper)] disabled:opacity-50">保存修改后的表述</button>
                  ) : (
                    <button type="button" onClick={() => { setEditingId(candidate.claimId); setEditDraft(candidate.statement); }}
                      className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--navy)] hover:bg-[var(--paper)]">修改后记住</button>
                  )}
                  {projects.length > 0 && (
                    <select aria-label="仅保留在该项目" defaultValue="" disabled={candidateBusyId === candidate.claimId}
                      onChange={(event) => { if (event.target.value) void confirmCandidate(candidate, { useScope: { mode: "PROJECTS", projectIds: [event.target.value] } }, "已仅在该项目中使用。"); }}
                      className="editorial-input min-h-8 w-auto px-2 py-1 text-xs">
                      <option value="">仅保留在…</option>
                      {projects.map((project) => <option key={project.id} value={project.id}>{project.title}</option>)}
                    </select>
                  )}
                  <button type="button" disabled={candidateBusyId === candidate.claimId}
                    onClick={() => void rejectCandidate(candidate)}
                    className="focus-ring rounded-lg px-3 py-1.5 text-xs font-bold text-[var(--ink-soft)] hover:bg-[var(--paper-strong)] disabled:opacity-50">拒绝</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card-surface mt-6 rounded-xl p-4 sm:p-5">
        <h2 className="text-sm font-bold text-[var(--ink)]">记忆使用与控制</h2>
        {policy ? (
          <div className="mt-3 space-y-3 text-sm">
            <label className="flex items-start justify-between gap-3">
              <span className="min-w-0"><span className="font-bold text-[var(--ink)]">在对话与委托中使用</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--ink-soft)]">关闭后项目资料与原任务照常可用，已保存内容保留。</span></span>
              <input type="checkbox" checked={policy.useInContextEnabled} disabled={busy}
                onChange={(event) => void togglePolicy({ useInContextEnabled: event.target.checked }, event.target.checked ? "已开启使用。" : "已关闭使用；项目资料与原任务不受影响。")}
                className="mt-1 h-4 w-4 shrink-0" />
            </label>
            <label className="flex items-start justify-between gap-3 border-t border-[var(--rule)]/60 pt-3">
              <span className="min-w-0"><span className="font-bold text-[var(--ink)]">允许把个人正文发给远端模型</span>
                <span className="mt-0.5 block text-xs leading-5 text-[var(--ink-soft)]">默认关闭：个人内容只在本地规则处理；开启后才可能随当轮原有云模型许可外发。</span></span>
              <input type="checkbox" checked={policy.cloudProcessingEnabled} disabled={busy}
                onChange={(event) => void togglePolicy({ cloudProcessingEnabled: event.target.checked }, event.target.checked ? "已允许远端处理个人正文（仍受当轮许可约束）。" : "已停止远端处理个人正文。")}
                className="mt-1 h-4 w-4 shrink-0" />
            </label>
            <p className="border-t border-[var(--rule)]/60 pt-3 text-xs leading-5 text-[var(--muted)]">候选归纳：{policy.candidateInferenceEnabled ? "已开启" : "默认关闭（首批）"}；删除全部条目后不会自动从旧聊天重建。</p>
            <p className="text-xs leading-5 text-[var(--muted)]"><a className="focus-ring font-bold text-[var(--teal-strong)] underline" href="/api/me/memory/export">导出我的记忆</a>（区分自述、候选与失效历史；不能用于导入恢复）</p>
          </div>
        ) : <p className="mt-3 text-xs text-[var(--muted)]">首次保存后生成策略。</p>}
      </section>
    </main>
  );
}
