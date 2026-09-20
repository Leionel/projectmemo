"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CalendarCheck2, Check, ChevronDown, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";

type ScheduleBlock = {
  id: string | null;
  actionId: string;
  actionTitle: string;
  start: string;
  end: string;
  locked: boolean;
  calendar?: { status: string; eventId: string | null; syncedAt: string | null; error: string | null };
};
type SkipReason = { actionId: string; actionTitle: string; reasonCode: string; message: string };
type SchedulePlanData = { id: string; version: number; status: string; blocks: ScheduleBlock[]; unscheduled: SkipReason[] };

/** 未排入原因分组：每个行动都必须能看懂为什么没被安排 */
const reasonGroups: Array<{ key: string; label: string; codes: string[] }> = [
  { key: "estimate", label: "缺少估时", codes: ["MISSING_ESTIMATE"] },
  { key: "blocked", label: "依赖阻塞", codes: ["BLOCKED"] },
  { key: "unknown", label: "证据不足", codes: ["UNKNOWN"] },
  { key: "closed", label: "行动已取消或完成", codes: ["DONE_OR_CANCELLED"] },
  { key: "capacity", label: "时间容量不足", codes: ["NO_CAPACITY"] },
  { key: "cross", label: "跨项目冲突", codes: ["CROSS_PROJECT_CONFLICT"] },
  { key: "version", label: "预览后版本变化", codes: ["VERSION_CHANGED", "ALREADY_SCHEDULED"] },
];

const calendarLabels: Record<string, string> = {
  NONE: "",
  PENDING: "日历写入中",
  SYNCED: "已写入系统日历",
  FAILED: "系统日历写入失败，仅应用内有效",
  REVOKED: "已从系统日历撤销",
};

function slotInstant(dayOffset: number, time: string) {
  const base = new Date();
  base.setDate(base.getDate() + dayOffset);
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  base.setHours(hours, minutes, 0, 0);
  return base.toISOString();
}

function formatSlot(start: string, end: string) {
  const from = new Date(start);
  const to = new Date(end);
  const date = from.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  const time = (value: Date) => value.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time(from)}–${time(to)}`;
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
    const slots: Array<{ start: string; end: string }> = [];
    for (let index = 1; index <= days; index++) {
      const start = slotInstant(index, startTime);
      const end = slotInstant(index, endTime);
      if (start && end && new Date(end).getTime() > new Date(start).getTime()) slots.push({ start, end });
    }
    return slots;
  }

  async function generatePreview() {
    const slots = buildSlots();
    if (slots.length === 0) {
      setError("可用时间区间无效：结束时间必须晚于开始时间，格式如 19:00。");
      return;
    }
    setBusy("preview");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}/schedule/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId: crypto.randomUUID(),
          rangeStart: slots[0].start,
          rangeEnd: slots[slots.length - 1].end,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
          slots,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "生成预览失败");
      setPreview(data.plan);
    } catch (caught) {
      // 失败不清空表单：用户填写的可用时间保留，可直接重试
      setError(caught instanceof Error ? caught.message : "生成预览失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPlan() {
    if (!preview) return;
    setBusy("confirm");
    setError("");
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
      // 确认失败保留预览与已填时间，用户改完可直接重新预览
      setError(caught instanceof Error ? caught.message : "确认安排失败");
    } finally {
      setBusy(null);
    }
  }

  async function cancelPlan() {
    if (!plan) return;
    setBusy("cancel");
    setError("");
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

  return <section id="schedule-planner" aria-labelledby="schedule-title" className="card-surface scroll-mt-24 rounded-[1.5rem] p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-3 border-b archive-rule pb-4">
      <div>
        <p className="archive-label">可执行安排</p>
        <h2 id="schedule-title" className="mt-2 flex items-center gap-2 text-lg font-black"><CalendarClock size={18} className="text-[var(--teal-strong)]" />安排未来 7 天</h2>
        <p className="mt-1 text-sm text-[var(--ink-soft)]">只安排当前可开始（READY）的行动；未排入的行动都会说明原因。</p>
      </div>
      <button type="button" onClick={() => { setOpen(!open); setPreview(null); }} className="focus-ring editorial-button-secondary">
        {open ? <X size={15} /> : <CalendarClock size={15} />}{open ? "收起" : "预览安排"}
      </button>
    </div>

    {message && <p role="status" className="mt-3 rounded-lg bg-[var(--teal-pale)] px-3 py-2 text-xs font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2">
      <p className="text-xs font-semibold text-[var(--brick)]">{error}</p>
      <div className="flex gap-2">
        {preview && <button type="button" onClick={() => void generatePreview()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">用当前时间重新预览</button>}
        <button type="button" onClick={() => void load()} className="focus-ring rounded-md bg-[var(--card-bg)] px-2 py-1 text-xs font-bold text-[var(--brick)]">重试</button>
      </div>
    </div>}

    {loading && <p className="mt-4 text-sm text-[var(--ink-soft)]">正在读取当前安排…</p>}

    {!loading && plan && plan.blocks.length > 0 && <div className="mt-4">
      <p className="text-xs font-black text-[var(--navy)]">当前已确认安排</p>
      <ul className="mt-2 space-y-1.5">
        {plan.blocks.map((block) => <li key={block.id} className="rounded-xl border border-[var(--teal)]/30 bg-[var(--teal-pale)] px-3 py-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-bold text-[var(--navy)]">{block.actionTitle || "行动"}</span>
            <span className="text-[var(--ink-soft)]">{formatSlot(block.start, block.end)}</span>
          </div>
          {block.calendar && block.calendar.status !== "NONE" && <p className={"mt-1 flex items-center gap-1.5 text-[11px] font-semibold " + (block.calendar.status === "FAILED" ? "text-[var(--amber)]" : "text-[var(--teal-strong)]")}>
            <CalendarCheck2 size={12} />{calendarLabels[block.calendar.status] ?? block.calendar.status}
            {block.calendar.status === "FAILED" && block.calendar.error ? `：${block.calendar.error}` : ""}
          </p>}
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
        {preview.blocks.length === 0 && <p className="mt-1.5 text-xs text-[var(--ink-soft)]">没有可安排的 READY 行动，原因见下方分组。</p>}
        <ul className="mt-2 space-y-1.5">
          {preview.blocks.map((block, index) => <li key={block.id ?? `${block.actionId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--card-bg)] px-2.5 py-1.5 text-xs">
            <span className="font-bold text-[var(--navy)]">{block.actionTitle || "行动"}{block.locked ? "（已锁定）" : ""}</span>
            <span className="text-[var(--ink-soft)]">{formatSlot(block.start, block.end)}</span>
          </li>)}
        </ul>
      </div>

      {reasonGroups.map((group) => {
        const items = preview.unscheduled.filter((item) => group.codes.includes(item.reasonCode));
        if (items.length === 0) return null;
        return <div key={group.key} className="mt-2 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-3">
          <p className="text-xs font-black text-[var(--navy)]">{group.label}（{items.length}）</p>
          <ul className="mt-1.5 space-y-1 text-xs leading-5 text-[var(--ink-soft)]">
            {items.map((item) => <li key={`${item.actionId}-${item.reasonCode}`}>· <span className="font-bold">{item.actionTitle || "行动"}</span>：{item.message}</li>)}
          </ul>
        </div>;
      })}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setPreview(null)} className="focus-ring editorial-button-secondary text-xs">重新填写时间</button>
        <button type="button" onClick={() => void confirmPlan()} disabled={busy === "confirm" || preview.blocks.length === 0} className="focus-ring editorial-button text-xs disabled:opacity-50">
          {busy === "confirm" ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}确认安排
        </button>
      </div>
    </div>}
  </section>;
}
