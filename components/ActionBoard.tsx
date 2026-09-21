"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, ChevronDown, Circle, LoaderCircle, Pencil, Plus, SlidersHorizontal, Star, X } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ActionItemData } from "@/lib/types";
import { actionStatusLabels } from "@/lib/types";
import { emitWorkspaceChange, subscribeWorkspaceChange } from "@/lib/client/workspaceEvents";
import { getDeviceKey } from "@/lib/client/deviceKey";
import { sortActions, type ActionSortMode } from "@/lib/projectDashboard";

type ActionView = "active" | "completed" | "all";
type EditDraft = { title: string; description: string; priority: number; dueDate: string };

const sortOptions: Array<{ value: ActionSortMode; label: string }> = [
  { value: "smart", label: "智能优先" },
  { value: "priority", label: "优先级最高" },
  { value: "due", label: "截止时间最近" },
  { value: "newest", label: "最近创建" },
];

function dueDateToIso(value: string) {
  return value ? new Date(`${value}T23:59:59`).toISOString() : null;
}

function dateInputValue(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export function ActionBoard({ projectId, initialActions, reminderEnabled = false }: { projectId: string; initialActions: ActionItemData[]; reminderEnabled?: boolean }) {
  const router = useRouter();
  const [actions, setActions] = useState(initialActions);
  const [view, setView] = useState<ActionView>("active");
  const [sortMode, setSortMode] = useState<ActionSortMode>("smart");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(3);
  const [dueDate, setDueDate] = useState("");
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");
  const [editFor, setEditFor] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [cancelFor, setCancelFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [now] = useState(() => new Date());
  /** 完成前的提醒处置询问：有未来设备日历日程时才会出现 */
  const [completionPrompt, setCompletionPrompt] = useState<{ actionId: string; question: string; options: Array<{ value: string; label: string }>; disposition: "KEEP" | "REMOVE" } | null>(null);

  useEffect(() => subscribeWorkspaceChange(projectId, ["actions"], () => {
    void fetch(`/api/projects/${projectId}/actions`).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      if (data?.actions) setActions(data.actions);
    });
  }), [projectId]);

  const projectActions = actions.filter((item) => !item.isSimulated);
  const simulatedActions = actions.filter((item) => item.isSimulated);
  const activeCount = projectActions.filter((item) => item.status === "TODO" || item.status === "DOING").length;
  const completedCount = projectActions.filter((item) => item.status === "DONE").length;
  const visibleActions = sortActions(projectActions.filter((item) => {
    if (view === "active") return item.status === "TODO" || item.status === "DOING";
    if (view === "completed") return item.status === "DONE";
    return true;
  }), sortMode, now);

  function notify(areas: Array<"actions" | "cards" | "interventions" | "metrics">) {
    emitWorkspaceChange(projectId, areas);
    router.refresh();
  }

  async function create() {
    if (title.trim().length < 2) return;
    setBusy("create");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || null, priority, dueAt: dueDateToIso(dueDate) }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "创建行动失败");
      setActions((old) => [data.action, ...old]);
      setTitle(""); setDescription(""); setPriority(3); setDueDate(""); setView("active");
      setMessage(data.reused ? "相同的未完成行动已存在，已为你定位到原行动。" : "行动项已加入待处理列表。");
      notify(["actions", "metrics"]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建行动失败");
    } finally {
      setBusy(null);
    }
  }

  async function patchAction(action: ActionItemData, payload: Record<string, unknown>, success: string) {
    setBusy(action.id);
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/actions/${action.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "更新行动失败");
      setActions((old) => old.map((item) => item.id === action.id ? { ...item, ...data.action } : item));
      setMessage(success);
      setEditFor(null); setEditDraft(null); setCancelFor(null); setCompletionPrompt(null);
      notify(["actions", "metrics"]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "更新行动失败");
    } finally {
      setBusy(null);
    }
  }

  /**
   * 打开完成回执表单。如果这条待办在设备日历里还有未来的日程，
   * 在同一区域先询问「保留还是移除」，不另开弹窗。
   */
  async function openResult(action: ActionItemData) {
    if (resultFor === action.id) {
      setResultFor(null);
      setResultText("");
      setCompletionPrompt(null);
      return;
    }
    setResultFor(action.id);
    setResultText("");
    setCancelFor(null);
    setCompletionPrompt(null);
    if (!reminderEnabled) return;
    try {
      const response = await fetch(`/api/projects/${projectId}/actions/${action.id}/reminder?deviceKey=${encodeURIComponent(getDeviceKey())}`);
      if (!response.ok) return;
      const data = await response.json().catch(() => null);
      const prompt = data?.state?.completionPrompt;
      if (prompt?.required) {
        setCompletionPrompt({
          actionId: action.id,
          question: prompt.question,
          options: prompt.options,
          disposition: "KEEP",
        });
      }
    } catch {
      // 读取提醒状态失败不阻塞完成流程：仍可正常填写回执
    }
  }

  async function complete(action: ActionItemData) {
    if (resultText.trim().length < 5) {
      setMessage("请先填写至少 5 个字的完成结果，结果会沉淀为复盘卡片。");
      return;
    }
    setBusy(action.id);
    setMessage("");
    try {
      const payload: Record<string, unknown> = { status: "DONE", resultText: resultText.trim() };
      if (completionPrompt && completionPrompt.actionId === action.id) {
        payload.reminderDisposition = completionPrompt.disposition;
        payload.deviceKey = getDeviceKey();
      }
      const response = await fetch(`/api/projects/${projectId}/actions/${action.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "完成行动失败");
      setActions((old) => old.map((item) => item.id === action.id ? { ...item, ...data.action, status: "DONE" } : item));
      setResultFor(null); setResultText(""); setCompletionPrompt(null);
      const outcome = data.reminderOutcome;
      if (outcome?.compensation?.needed) {
        setMessage(`行动已完成并移入历史，结果已沉淀为阶段复盘卡片。提醒方面：${outcome.compensation.message}`);
      } else if (outcome?.disposition === "REMOVE" && Array.isArray(outcome.devicePlan) && outcome.devicePlan.length > 0) {
        setMessage("行动已完成并移入历史，结果已沉淀为阶段复盘卡片。设备日历里的那条未来日程已标记为移除，请在鸿蒙客户端确认删除。");
      } else if (outcome?.disposition === "KEEP") {
        setMessage("行动已完成并移入历史，结果已沉淀为阶段复盘卡片。设备日历里的日程按你的选择保留。");
      } else {
        setMessage("行动已完成并移入历史，结果已沉淀为阶段复盘卡片。");
      }
      notify(["actions", "cards", "interventions", "metrics"]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "完成行动失败");
    } finally {
      setBusy(null);
    }
  }

  function beginEdit(action: ActionItemData) {
    setEditFor(action.id);
    setEditDraft({ title: action.title, description: action.description ?? "", priority: action.priority, dueDate: dateInputValue(action.dueAt) });
    setCancelFor(null);
    setResultFor(null);
  }

  const views: Array<{ value: ActionView; label: string; count: number }> = [
    { value: "active", label: "待处理", count: activeCount },
    { value: "completed", label: "已完成", count: completedCount },
    { value: "all", label: "全部", count: projectActions.length },
  ];

  return <section id="action-board" aria-labelledby="action-board-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div><p className="archive-label">行动闭环</p><h2 id="action-board-title" className="mt-2 flex items-center gap-2 text-lg font-black"><Check size={18} className="text-[var(--teal-strong)]" />项目行动板</h2><p className="mt-1 text-sm text-[var(--ink-soft)]">优先处理临近截止和高优先级行动；完成结果会自动沉淀为复盘卡。</p></div>
      <span className="text-xs font-bold text-[var(--muted)]">{completedCount} / {projectActions.length} 已完成</span>
    </div>

    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="行动显示范围" className="inline-flex rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-1">{views.map((item) => <button key={item.value} type="button" onClick={() => setView(item.value)} aria-pressed={view === item.value} className={"focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold transition " + (view === item.value ? "bg-[var(--paper-strong)] text-[var(--navy)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--navy)]")}>{item.label} <span className="ml-1 text-[10px]">{item.count}</span></button>)}</div>
      <label className="flex items-center gap-2 text-xs font-bold text-[var(--muted)]"><SlidersHorizontal size={14} /><span className="sr-only sm:not-sr-only">排列</span><select aria-label="行动排列方式" value={sortMode} onChange={(event) => setSortMode(event.target.value as ActionSortMode)} className="focus-ring rounded-lg border border-[var(--rule)] bg-[var(--paper-strong)] px-2.5 py-1.5 text-xs font-bold text-[var(--navy)]">{sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
    </div>

    <div className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
      <div className="flex gap-2"><input aria-label="新增行动标题" value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} disabled={busy === "create"} className="focus-ring editorial-input min-w-0 flex-1 px-3 py-2.5 text-sm" placeholder="新增一个可执行行动，例如：补齐演示脚本" /><button type="button" onClick={() => void create()} disabled={busy === "create" || title.trim().length < 2} className="focus-ring editorial-button-secondary disabled:opacity-50">{busy === "create" ? <LoaderCircle size={16} className="animate-spin" /> : <Plus size={16} />}新增</button></div>
      <details className="mt-2"><summary className="focus-ring w-fit cursor-pointer list-none rounded-lg px-1 py-1 text-xs font-bold text-[var(--teal-strong)]"><ChevronDown size={13} className="mr-1 inline" />补充优先级、截止时间和说明</summary><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-[var(--ink-soft)]">优先级<select aria-label="新行动优先级" value={priority} onChange={(event) => setPriority(Number(event.target.value))} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2 text-sm">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><label className="text-xs font-bold text-[var(--ink-soft)]">截止日期<input aria-label="新行动截止日期" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2 text-sm" /></label><label className="text-xs font-bold text-[var(--ink-soft)] sm:col-span-2">补充说明<textarea aria-label="新行动说明" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={2} className="focus-ring editorial-input mt-1.5 w-full resize-y px-3 py-2 text-sm" /></label></div></details>
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    <div className="mt-4 space-y-3">{visibleActions.length ? visibleActions.map((action) => <ActionCard key={action.id} action={action} now={now} busy={busy} resultFor={resultFor} resultText={resultText} editFor={editFor} editDraft={editDraft} cancelFor={cancelFor} onSetResultFor={setResultFor} onSetResultText={setResultText} onBeginEdit={beginEdit} onSetEditDraft={setEditDraft} onCloseEdit={() => { setEditFor(null); setEditDraft(null); }} onSetCancelFor={setCancelFor} onPatch={patchAction} onComplete={complete} onOpenResult={openResult} completionPrompt={completionPrompt} onSetCompletionDisposition={(value) => setCompletionPrompt((previous) => previous ? { ...previous, disposition: value } : previous)} />) : <EmptyState view={view} hasActions={projectActions.length > 0} onShowActive={() => setView("active")} />}</div>
    {simulatedActions.length > 0 && <details className="mt-4 rounded-xl border border-dashed border-[var(--amber)] bg-[var(--amber)]/10 p-3 text-xs"><summary className="focus-ring cursor-pointer rounded font-bold text-[var(--amber)]">查看 {simulatedActions.length} 条演示行动（不计入真实完成率）</summary><ul className="mt-2 space-y-1.5 text-[var(--ink-soft)]">{simulatedActions.map((action) => <li key={action.id}>· {action.title}</li>)}</ul></details>}
  </section>;
}

type ActionCardProps = {
  action: ActionItemData;
  now: Date;
  busy: string | null;
  resultFor: string | null;
  resultText: string;
  editFor: string | null;
  editDraft: EditDraft | null;
  cancelFor: string | null;
  onSetResultFor: (id: string | null) => void;
  onSetResultText: (value: string) => void;
  onBeginEdit: (action: ActionItemData) => void;
  onSetEditDraft: (draft: EditDraft | null) => void;
  onCloseEdit: () => void;
  onSetCancelFor: (id: string | null) => void;
  onPatch: (action: ActionItemData, payload: Record<string, unknown>, success: string) => Promise<void>;
  onComplete: (action: ActionItemData) => Promise<void>;
  onOpenResult: (action: ActionItemData) => void;
  onSetCompletionDisposition: (value: "KEEP" | "REMOVE") => void;
  completionPrompt: { actionId: string; question: string; options: Array<{ value: string; label: string }>; disposition: "KEEP" | "REMOVE" } | null;
};

function ActionCard(props: ActionCardProps) {
  const { action, now, busy, resultFor, resultText, editFor, editDraft, cancelFor, completionPrompt } = props;
  const completed = action.status === "DONE";
  const cancelled = action.status === "CANCELLED";
  const due = action.dueAt ? new Date(action.dueAt) : null;
  const overdue = Boolean(due && due.getTime() < now.getTime() && !completed && !cancelled);
  return <article className={"rounded-xl border p-3.5 " + (completed ? "border-[var(--teal)]/30 bg-[var(--teal-pale)]" : cancelled ? "border-[var(--rule)] bg-[var(--paper-strong)] opacity-75" : overdue ? "border-[var(--brick)]/35 bg-[var(--brick-pale)]/35" : "border-[var(--rule)] bg-[var(--card-bg)]")}>
    <div className="flex items-start gap-3"><span className="mt-0.5 text-[var(--teal-strong)]">{completed ? <Check size={17} /> : <Circle size={17} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className={"text-sm font-bold " + (completed ? "line-through opacity-70" : "")}>{action.title}</h3><span className="text-[11px] font-bold text-[var(--muted)]">{actionStatusLabels[action.status]}</span></div>{action.description && <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{action.description}</p>}<div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-[var(--muted)]"><span className="inline-flex items-center gap-1 rounded-md bg-[var(--card-bg)] px-2 py-1"><Star size={12} className="text-[var(--amber)]" />优先级 {action.priority}/5</span>{due && <span className={"inline-flex items-center gap-1 rounded-md bg-[var(--card-bg)] px-2 py-1 " + (overdue ? "text-[var(--brick)]" : "")}><CalendarDays size={12} />{due.toLocaleDateString("zh-CN")} {overdue ? "已逾期" : "截止"}</span>}</div>{action.resultText && <p className="mt-2 rounded-lg bg-[var(--card-bg)] p-2 text-xs leading-5 text-[var(--ink-soft)]"><span className="font-bold">回执：</span>{action.resultText}</p>}
      {!completed && !cancelled && editFor !== action.id && <div className="mt-3 flex flex-wrap gap-2">{action.status === "TODO" ? <button type="button" onClick={() => void props.onPatch(action, { status: "DOING" }, "行动已开始。") } disabled={Boolean(busy)} className="focus-ring rounded-lg bg-[var(--paper)] px-2.5 py-1.5 text-xs font-bold text-[var(--navy)]">▶ 开始</button> : <button type="button" onClick={() => void props.onPatch(action, { status: "TODO" }, "行动已退回待处理。") } disabled={Boolean(busy)} className="focus-ring rounded-lg bg-[var(--paper)] px-2.5 py-1.5 text-xs font-bold text-[var(--navy)]">暂停</button>}<button type="button" onClick={() => props.onOpenResult(action)} disabled={Boolean(busy)} className="focus-ring rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-xs font-bold text-[var(--teal-strong)]">完成并写回执</button><button type="button" onClick={() => props.onBeginEdit(action)} disabled={Boolean(busy)} className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--ink-soft)] hover:bg-[var(--paper-strong)]"><Pencil size={13} className="mr-1 inline" />编辑</button><button type="button" onClick={() => props.onSetCancelFor(cancelFor === action.id ? null : action.id)} disabled={Boolean(busy)} className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--muted)]">取消行动</button></div>}
      {cancelFor === action.id && <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs"><span className="font-bold text-[var(--brick)]">确定取消这项行动？</span><button type="button" onClick={() => void props.onPatch(action, { status: "CANCELLED" }, "行动已取消，可在“全部”中查看。") } disabled={busy === action.id} className="focus-ring rounded-md bg-[var(--brick)] px-2 py-1 font-bold text-white">确认取消</button><button type="button" onClick={() => props.onSetCancelFor(null)} className="focus-ring rounded-md px-2 py-1 font-bold">返回</button></div>}
      {editFor === action.id && editDraft && <div className="mt-3 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-[var(--ink-soft)] sm:col-span-2">标题<input value={editDraft.title} onChange={(event) => props.onSetEditDraft({ ...editDraft, title: event.target.value })} maxLength={160} className="focus-ring editorial-input mt-1 w-full px-3 py-2 text-sm" /></label><label className="text-xs font-bold text-[var(--ink-soft)]">优先级<select value={editDraft.priority} onChange={(event) => props.onSetEditDraft({ ...editDraft, priority: Number(event.target.value) })} className="focus-ring editorial-input mt-1 w-full px-3 py-2 text-sm">{[1,2,3,4,5].map((value) => <option key={value} value={value}>{value} / 5</option>)}</select></label><label className="text-xs font-bold text-[var(--ink-soft)]">截止日期<input type="date" value={editDraft.dueDate} onChange={(event) => props.onSetEditDraft({ ...editDraft, dueDate: event.target.value })} className="focus-ring editorial-input mt-1 w-full px-3 py-2 text-sm" /></label><label className="text-xs font-bold text-[var(--ink-soft)] sm:col-span-2">说明<textarea value={editDraft.description} onChange={(event) => props.onSetEditDraft({ ...editDraft, description: event.target.value })} maxLength={500} rows={2} className="focus-ring editorial-input mt-1 w-full resize-y px-3 py-2 text-sm" /></label></div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={props.onCloseEdit} className="focus-ring editorial-button-secondary text-xs"><X size={14} />取消</button><button type="button" onClick={() => void props.onPatch(action, { title: editDraft.title.trim(), description: editDraft.description.trim() || null, priority: editDraft.priority, dueAt: dueDateToIso(editDraft.dueDate) }, "行动信息已更新。") } disabled={busy === action.id || editDraft.title.trim().length < 2} className="focus-ring editorial-button text-xs">{busy === action.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}保存</button></div></div>}
      {resultFor === action.id && <div className="mt-3 rounded-xl border border-[var(--teal)]/30 bg-[var(--card-bg)] p-3"><label htmlFor={`result-${action.id}`} className="text-xs font-black text-[var(--navy)]">完成结果（会生成复盘卡）</label><textarea id={`result-${action.id}`} value={resultText} onChange={(event) => props.onSetResultText(event.target.value)} rows={3} maxLength={2000} className="focus-ring editorial-input mt-2 w-full p-2.5 text-sm" placeholder="写下完成了什么、验证结果和仍需跟进的地方" />
        {completionPrompt?.actionId === action.id && <fieldset className="mt-2 rounded-lg bg-[var(--amber)]/10 p-2.5">
          <legend className="px-1 text-xs font-bold text-[var(--amber)]">设备日历提醒</legend>
          <p className="text-xs font-semibold text-[var(--ink-soft)]">{completionPrompt.question}</p>
          <div className="mt-1.5 space-y-1">
            {completionPrompt.options.map((option) => <label key={option.value} className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-soft)]">
              <input
                type="radio"
                name={`reminder-disposition-${action.id}`}
                checked={completionPrompt.disposition === option.value}
                onChange={() => props.onSetCompletionDisposition(option.value === "REMOVE" ? "REMOVE" : "KEEP")}
                className="focus-ring"
              />
              {option.label}
            </label>)}
          </div>
        </fieldset>}
        <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => props.onSetResultFor(null)} className="focus-ring rounded-lg px-2.5 py-1.5 text-xs font-bold">取消</button><button type="button" onClick={() => void props.onComplete(action)} disabled={busy === action.id} className="focus-ring editorial-button text-xs">{busy === action.id ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}确认完成</button></div></div>}
    </div></div>
  </article>;
}

function EmptyState({ view, hasActions, onShowActive }: { view: ActionView; hasActions: boolean; onShowActive: () => void }) {
  if (view === "completed" && hasActions) return <div className="rounded-xl bg-[var(--paper-strong)] p-5 text-center"><p className="text-sm font-bold text-[var(--ink-soft)]">还没有已完成的行动。</p><button type="button" onClick={onShowActive} className="focus-ring mt-2 text-xs font-black text-[var(--teal-strong)] underline underline-offset-4">返回待处理</button></div>;
  if (view === "active" && hasActions) return <div className="rounded-xl bg-[var(--paper-strong)] p-5 text-center"><Check className="mx-auto text-[var(--teal)]" /><p className="mt-2 text-sm font-bold text-[var(--ink-soft)]">当前待办已清空。</p><p className="mt-1 text-xs text-[var(--muted)]">已完成和已取消行动仍保留在历史中。</p></div>;
  return <p className="rounded-xl bg-[var(--paper-strong)] p-5 text-center text-sm text-[var(--ink-soft)]">还没有行动项。接受一条主动提醒，或在这里手动新增。</p>;
}
