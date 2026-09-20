"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

type ScheduleBlock = { id: string | null; actionId: string; actionTitle: string; start: string; end: string; locked: boolean };
type SkipReason = { actionId: string; actionTitle: string; reasonCode: string; message: string };
type SchedulePlanData = { id: string; version: number; status: string; blocks: ScheduleBlock[]; unscheduled: SkipReason[] };

const reasonLabels: Record<string, string> = {
  MISSING_ESTIMATE: "待补估时", BLOCKED: "受阻", UNKNOWN: "待确认", NO_CAPACITY: "容量不足",
  VERSION_CHANGED: "版本变化", ALREADY_SCHEDULED: "已在计划中", DONE_OR_CANCELLED: "已完成或取消",
};

function localDateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function slotInstant(dayOffset: number, time: string) {
  const base = localDateOffset(dayOffset);
  const [hours, minutes] = time.split(":").map(Number);
  base.setHours(hours, minutes, 0, 0);
  return base.toISOString();
}

export function SchedulePlanner({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const router = useRouter();
  const [plan, setPlan] = useState<SchedulePlanData | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [startTime, setStartTime] = useState("19:00");
  const [endTime, setEndTime] = useState("21:30");
  const [days, setDays] = useState(7);
  const [preview, setPreview] = useState<SchedulePlanData | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/schedule/current`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取当前安排失败");
      setPlan(data.plan ?? null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取当前安排失败");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 均发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (enabled) void load();
  }, [enabled, load]);

  if (!enabled) return null;

  function buildSlots() {
    const slots = [];
    for (let index = 1; index <= days; index++) {
      const start = slotInstant(index, startTime);
      const end = slotInstant(index, endTime);
      if (new Date(end).getTime() > new Date(start).getTime()) slots.push({ start, end });
    }
    return slots;
  }

  async function generatePreview() {
    const slots = buildSlots();
    if (!slots.length) {
      setError("可用时间区间无效：结束时间必须晚于开始时间。");
      return;
    }
    setBusy("preview");
    setError("");
    try {
      const rangeStart = slots[0].start;
      const rangeEnd = slots[slots.length - 1].end;
      const response = await fetch(`/api/projects/${projectId}/schedule/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          rangeStart,
          rangeEnd,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
          slots,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成预览失败");
      setPreview(data.plan);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成预览失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPlan() {
    if (!preview) return;
    setBusy("confirm");
    try {
      const response = await fetch(`/api/projects/${projectId}/schedule/${preview.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), expectedVersion: preview.version }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "确认安排失败");
      setPreview(null);
      setOpen(false);
      setMessage("未来安排已确认。");
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "确认安排失败");
    } finally {
      setBusy(null);
    }
  }

  async function cancelPlan() {
    if (!plan) return;
    setBusy("cancel");
    try {
      const response = await fetch(`/api/projects/${projectId}/schedule/${plan.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), action: "cancel" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "取消安排失败");
      setMessage("已取消当前安排，历史保留。");
      await load();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "取消安排失败");
    } finally {
      setBusy(null);
    }
  }

  const groups: Array<{ key: string; label: string; items: SkipReason[] }> = [
    { key: "missing", label: reasonLabels.MISSING_ESTIMATE, items: preview?.unscheduled.filter((item) => item.reasonCode === "MISSING_ESTIMATE") ?? [] },
    { key: "stuck", label: "受阻 / 待确认", items: preview?.unscheduled.filter((item) => item.reasonCode === "BLOCKED" || item.reasonCode === "UNKNOWN") ?? [] },
    { key: "capacity", label: "容量不足", items: preview?.unscheduled.filter((item) => item.reasonCode === "NO_CAPACITY" || item.reasonCode === "VERSION_CHANGED" || item.reasonCode === "ALREADY_SCHEDULED" || item.reasonCode === "DONE_OR_CANCELLED") ?? [] },
  ];

  return <section id="schedule-planner" aria-labelledby="schedule-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div>
        <p className="archive-label">可执行安排</p>
        <h2 id="schedule-title" className="mt-2 flex items-center gap-2 text-lg font-black"><CalendarClock size={18} className="text-[var(--teal-strong)]" />安排未来 7 天</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">只安排当前可开始（READY）的行动；受阻和缺估时的行动会说明原因。</p>
      </div>
      <button type="button" onClick={() => { setOpen(!open); setPreview(null); }} className="focus-ring editorial-button-secondary">
        {open ? <X size={15} /> : <CalendarClock size={15} />}{open ? "收起" : "预览安排"}
      </button>
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <p role="alert" className="mt-3 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">{error}</p>}

    {loading && <p className="mt-4 text-sm text-[var(--ink-soft)]">正在读取当前安排…</p>}

    {!loading && plan && plan.blocks.length > 0 && <div className="mt-4">
      <p className="text-xs font-black text-[var(--navy)]">当前已确认安排</p>
      <ul className="mt-2 space-y-1.5">
        {plan.blocks.map((block) => <li key={block.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--teal)]/30 bg-[var(--teal-pale)] px-3 py-2 text-xs">
          <span className="font-bold text-[var(--navy)]">{block.actionTitle || "行动"}</span>
          <span className="text-[var(--ink-soft)]">{new Date(block.start).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} – {new Date(block.end).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
        </li>)}
      </ul>
      <button type="button" onClick={() => void cancelPlan()} disabled={busy === "cancel"} className="focus-ring mt-3 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--muted)] hover:bg-[var(--paper-strong)]">取消这份安排</button>
    </div>}

    {!loading && open && !preview && <div className="mt-4 rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs font-bold text-[var(--ink-soft)]">每天开始时间<input aria-label="每天开始时间" type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ink-soft)]">每天结束时间<input aria-label="每天结束时间" type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2 text-sm" /></label>
        <label className="text-xs font-bold text-[var(--ink-soft)]">安排天数<select aria-label="安排天数" value={days} onChange={(event) => setDays(Number(event.target.value))} className="focus-ring editorial-input mt-1.5 w-full px-3 py-2 text-sm">{[3, 5, 7].map((value) => <option key={value} value={value}>未来 {value} 天</option>)}</select></label>
      </div>
      <button type="button" onClick={() => void generatePreview()} disabled={busy === "preview"} className="focus-ring editorial-button mt-3 text-xs">
        {busy === "preview" ? <LoaderCircle size={14} className="animate-spin" /> : <ChevronDown size={14} />}生成排程预览
      </button>
    </div>}

    {preview && <div className="mt-4">
      <div className="rounded-xl border border-[var(--teal)]/30 bg-[var(--teal-pale)] p-3">
        <p className="text-xs font-black text-[var(--teal-strong)]">已安排（{preview.blocks.length}）</p>
        {preview.blocks.length === 0 && <p className="mt-1.5 text-xs text-[var(--ink-soft)]">没有可安排的 READY 行动。</p>}
        <ul className="mt-2 space-y-1.5">
          {preview.blocks.map((block, index) => <li key={block.id ?? `${block.actionId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--card-bg)] px-2.5 py-1.5 text-xs">
            <span className="font-bold text-[var(--navy)]">{block.actionTitle || "行动"}</span>
            <span className="text-[var(--ink-soft)]">{new Date(block.start).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} – {new Date(block.end).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}{block.locked ? "（已锁定）" : ""}</span>
          </li>)}
        </ul>
      </div>
      {groups.map((group) => group.items.length > 0 && <div key={group.key} className="mt-2 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-3">
        <p className="text-xs font-black text-[var(--navy)]">{group.label}（{group.items.length}）</p>
        <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[var(--ink-soft)]">
          {group.items.map((item) => <li key={item.actionId}>· <span className="font-bold">{item.actionTitle || "行动"}</span>：{item.message}</li>)}
        </ul>
      </div>)}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setPreview(null)} className="focus-ring editorial-button-secondary text-xs">重新填写时间</button>
        <button type="button" onClick={() => void confirmPlan()} disabled={busy === "confirm" || preview.blocks.length === 0} className="focus-ring editorial-button text-xs disabled:opacity-50">
          {busy === "confirm" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}确认安排
        </button>
      </div>
    </div>}
  </section>;
}
