"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, Check, LoaderCircle, RefreshCw, Trash2, X } from "lucide-react";
import { getDeviceKey } from "@/lib/client/deviceKey";
import { resolveReminderPanel } from "@/lib/client/reminderPanelState";

type ReminderSyncStatus =
  | "NOT_SCHEDULED"
  | "PLANNED"
  | "PENDING"
  | "SYNCED"
  | "FAILED"
  | "PERMISSION_DENIED"
  | "MISSING"
  | "UNSUPPORTED"
  | "REVOKED";

type ReminderState = {
  actionId: string;
  actionTitle: string;
  actionStatus: string;
  feasibility: "READY" | "BLOCKED" | "UNKNOWN";
  status: ReminderLifecycleStatusAlias;
  statusLabel: string;
  statusDetail: string;
  canArrange: boolean;
  blockedReason: string | null;
  requiresRevokeBeforeChange: boolean;
  outstandingDeviceEvent: { reminderId: string | null; eventId: string; source: string } | null;
  reminder: { id: string; reminderAt: string; durationMinutes: number; calendarEventId: string | null; calendarId: string | null; revision: number; error: string | null } | null;
  planBlock: { blockId: string; start: string; end: string; calendarEventId: string | null } | null;
  durationMinutes: number;
  permissionPurpose: string;
  completionPrompt: { required: boolean; question: string; options: Array<{ value: string; label: string }> } | null;
};
type ReminderLifecycleStatusAlias = ReminderSyncStatus;

/** datetime-local 需要本地时区的 YYYY-MM-DDTHH:mm，不能用 toISOString 直接切 */
function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultReminderValue(): string {
  const target = new Date(Date.now() + 2 * 60 * 60 * 1000);
  target.setMinutes(0, 0, 0);
  return toLocalInputValue(target);
}

/**
 * 单条待办的日历提醒面板（内联，不使用弹窗，避免嵌套模态）。
 *
 * 诚实边界：浏览器不能写入系统日历。这里只保存项目内计划时间，
 * 并如实说明「还没有写进设备日历」，不会显示假成功。
 */
export function ActionReminderPanel({
  projectId,
  actionId,
  onClose,
}: {
  projectId: string;
  actionId: string;
  onClose?: () => void;
}) {
  const [state, setState] = useState<ReminderState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reminderAt, setReminderAt] = useState(defaultReminderValue);
  /**
   * 一次用户意图一个 requestId：超时或失败后的重试沿用同一个；
   * 只有成功保存（用户开始下一次安排意图）才换新的。
   */
  const [pendingRequestId, setPendingRequestId] = useState(() => crypto.randomUUID());
  /** 撤销同样是一次用户意图一个 ID，重试沿用同一个 */
  const [revokeRequestId, setRevokeRequestId] = useState(() => crypto.randomUUID());
  const [durationMinutes, setDurationMinutes] = useState(30);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/actions/${actionId}/reminder?deviceKey=${encodeURIComponent(getDeviceKey())}`,
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "读取提醒状态失败");
      setState(data.state as ReminderState);
      if (data.state?.reminder?.reminderAt) setReminderAt(toLocalInputValue(new Date(data.state.reminder.reminderAt)));
      if (data.state?.durationMinutes) setDurationMinutes(data.state.durationMinutes);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读取提醒状态失败");
    } finally {
      setLoading(false);
    }
  }, [projectId, actionId]);

  useEffect(() => {
    // 挂载后异步拉取；setState 都发生在 await 之后
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function savePlanTime() {
    // 设备上已有自有日程时不允许直接提交：服务端必然 409，界面不给死按钮
    if (!decision.canSubmitTime) {
      setError(decision.reason ?? "当前还不能修改时间。");
      return;
    }
    setBusy("arrange");
    setMessage("");
    setError("");
    try {
      const payload: Record<string, unknown> = {
        requestId: pendingRequestId,
        reminderAt: new Date(reminderAt).toISOString(),
        durationMinutes,
      };
      // 修改已有提醒必须带上读到的版本号，服务端据此做原子 CAS
      if (decision.requiresExpectedRevision && state?.reminder) {
        payload.expectedRevision = state.reminder.revision;
      }
      const response = await fetch(`/api/projects/${projectId}/actions/${actionId}/reminder`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pm-device-key": getDeviceKey() },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const code = data?.error?.code as string | undefined;
        // 版本过期 / 缺版本号：刷新最新状态，保留用户填的时间，让用户再点一次即可成功
        if (code === "REMINDER_REVISION_CHANGED" || code === "REMINDER_EXPECTED_REVISION_REQUIRED") {
          await load();
          setError(`${data?.error?.message ?? "提醒已被其他操作修改"}。你填的时间已保留，请再点一次保存。`);
          return;
        }
        if (code === "REQUEST_ID_REUSED") {
          // 上一次同 ID 请求其实已经成功落库：换成新的意图 ID 并刷新真实状态
          setPendingRequestId(crypto.randomUUID());
          await load();
          setError(`${data?.error?.message ?? "这次请求此前已经处理过"}。已刷新为最新状态，请再确认一次。`);
          return;
        }
        throw new Error(data?.error?.message ?? "保存计划时间失败");
      }
      if (data?.historical) {
        setMessage(data?.message ?? "这次请求此前已经处理过，当前显示的是最新状态，没有覆盖它。");
      } else {
        setMessage(
          data?.message
            ?? "计划时间已保存到忆程。这台浏览器不能写系统日历，需要在鸿蒙客户端的这条待办里写入才会收到设备提醒。",
        );
      }
      // 这次意图已经完成，下一次修改用新的 requestId
      setPendingRequestId(crypto.randomUUID());
      await load();
    } catch (caught) {
      // 失败保留用户填写的日期时间
      setError(caught instanceof Error ? caught.message : "保存计划时间失败");
    } finally {
      setBusy(null);
    }
  }

  async function revoke() {
    const reminderId = state?.reminder?.id;
    if (!reminderId) {
      setError("这条提醒还没有回执，无法撤销。");
      return;
    }
    setBusy("revoke");
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/reminders/${reminderId}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pm-device-key": getDeviceKey() },
        body: JSON.stringify({ requestId: revokeRequestId }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error?.message ?? "撤销提醒失败");
      const devicePlan = Array.isArray(data?.devicePlan) ? data.devicePlan : [];
      setMessage(
        devicePlan.length > 0
          ? "服务端提醒已撤销；设备日历里仍可能留有这条自有日程，需要在鸿蒙客户端删除后才能确认清理完成。"
          : (data?.message ?? "提醒已撤销，设备上没有需要删除的自有日程。"),
      );
      // 这次撤销意图已经完成，下一次撤销用新的 requestId
      setRevokeRequestId(crypto.randomUUID());
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "撤销提醒失败，可以重试");
    } finally {
      setBusy(null);
    }
  }

  async function retryDeviceWrite() {
    const reminderId = state?.reminder?.id;
    if (!reminderId) return;
    setBusy("retry");
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/reminders/${reminderId}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-pm-device-key": getDeviceKey() },
        body: JSON.stringify({ status: "FAILED", error: "浏览器端重试：等待鸿蒙客户端写入系统日历" }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error?.message ?? "更新提醒状态失败");
      }
      setMessage("已记录：计划时间仍在忆程里，请在鸿蒙客户端重试写入系统日历。");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "更新提醒状态失败");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <p className="mt-2 flex items-center gap-1.5 text-xs text-[var(--muted)]"><LoaderCircle size={13} className="animate-spin" />正在读取提醒状态…</p>;
  }

  if (!state) {
    return <div className="mt-2 rounded-lg bg-[var(--brick-pale)] px-3 py-2 text-xs font-semibold text-[var(--brick)]">
      {error || "提醒状态暂时读不到。"}
      <button type="button" onClick={() => void load()} className="focus-ring ml-2 rounded-md bg-[var(--card-bg)] px-2 py-1 font-bold">重试</button>
    </div>;
  }

  const status = state.status;
  const needsPermissionHelp = status === "PERMISSION_DENIED";
  const unsupported = status === "UNSUPPORTED";
  const decision = resolveReminderPanel({
    status,
    canArrange: state.canArrange,
    requiresRevokeBeforeChange: state.requiresRevokeBeforeChange,
    blockedReason: state.blockedReason,
    revision: state.reminder?.revision ?? null,
    hasReminderRecord: state.reminder !== null,
    calendarEventId: state.reminder?.calendarEventId ?? state.planBlock?.calendarEventId ?? null,
    calendarId: state.reminder?.calendarId ?? null,
  });

  return <div className="mt-2 rounded-xl border border-[var(--rule)] bg-[var(--paper-strong)] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[11px] font-black text-[var(--navy)]">日历提醒</p>
        <p className="mt-1 text-xs font-bold text-[var(--ink-soft)]">{state.statusLabel}</p>
        <p className="mt-0.5 text-[11px] leading-5 text-[var(--muted)]">{state.statusDetail}</p>
        {state.reminder?.reminderAt && <p className="mt-1 text-[11px] text-[var(--muted)]">
          忆程里的计划时间：{new Date(state.reminder.reminderAt).toLocaleString("zh-CN", { hour12: false })} · 持续 {state.durationMinutes} 分钟
        </p>}
        {state.planBlock && <p className="mt-1 text-[11px] text-[var(--muted)]">
          已确认的排程时段：{new Date(state.planBlock.start).toLocaleString("zh-CN", { hour12: false })}（这条来自「安排未来 7 天」）
        </p>}
        {state.reminder?.error && <p className="mt-1 text-[11px] font-semibold text-[var(--brick)]">上次失败原因：{state.reminder.error}</p>}
      </div>
      {onClose && <button type="button" onClick={onClose} aria-label="收起提醒设置" className="focus-ring shrink-0 rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--card-bg)]"><X size={14} /></button>}
    </div>

    {message && <p role="status" className="mt-2 rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--teal-strong)]">{message}</p>}
    {error && <p role="alert" className="mt-2 rounded-lg bg-[var(--brick-pale)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--brick)]">{error}</p>}

    <dl className="mt-2 grid gap-1 text-[11px] leading-5">
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="font-bold text-[var(--ink-soft)]">计划时间：</dt>
        <dd className="text-[var(--muted)]">{decision.planStateLabel}</dd>
      </div>
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="font-bold text-[var(--ink-soft)]">设备日历：</dt>
        <dd className="text-[var(--muted)]">{decision.deviceStateLabel}</dd>
      </div>
      <div className="flex flex-wrap gap-x-1.5">
        <dt className="font-bold text-[var(--ink-soft)]">下一步：</dt>
        <dd className="text-[var(--muted)]">{decision.nextStep}</dd>
      </div>
    </dl>

    {decision.reason && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--amber)]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--amber)]">
      <AlertTriangle size={13} className="mt-0.5 shrink-0" />{decision.reason}
    </p>}

    {decision.requiresHarmonyDevice && <p className="mt-2 rounded-lg bg-[var(--paper-strong)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ink-soft)]">
      浏览器不能读写系统日历，因此设备上的日程只能在鸿蒙客户端处理；忆程只会清理自己创建、「忆程·」开头的日程。
    </p>}

    {needsPermissionHelp && <p className="mt-2 rounded-lg bg-[var(--amber)]/10 px-2.5 py-1.5 text-[11px] font-semibold text-[var(--amber)]">
      重新授权方式：在手机「设置 → 应用 → 忆程 → 权限」里允许「日历」的读取与写入，然后回到鸿蒙客户端重试写入。
    </p>}

    {unsupported && <p className="mt-2 rounded-lg bg-[var(--paper-strong)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--ink-soft)]">
      这台设备不支持系统日历，忆程只保存项目内的计划时间，不会有设备级提醒。
    </p>}

    {decision.canSubmitTime && <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <label className="min-w-0">
        <span className="sr-only">提醒时间</span>
        <input
          type="datetime-local"
          value={reminderAt}
          onChange={(event) => setReminderAt(event.target.value)}
          className="focus-ring w-full rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2.5 py-1.5 text-xs"
        />
      </label>
      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-soft)]">
        持续
        <input
          type="number"
          min={5}
          max={240}
          value={durationMinutes}
          onChange={(event) => setDurationMinutes(Number(event.target.value))}
          className="focus-ring w-16 rounded-lg border border-[var(--rule)] bg-[var(--card-bg)] px-2 py-1.5 text-xs"
        />
        分钟
      </label>
      <button type="button" onClick={() => void savePlanTime()} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
        {busy === "arrange" ? <LoaderCircle size={14} className="animate-spin" /> : <CalendarPlus size={14} />}
        {decision.requiresExpectedRevision ? "改到这个时间" : "保存计划时间"}
      </button>
    </div>}

    <p className="mt-1.5 text-[11px] leading-5 text-[var(--muted)]">
      默认持续 30 分钟，在事件开始时提醒；系统日历里的日程标题以「忆程·」开头，便于区分你自己的日程。
      {state.permissionPurpose ? ` ${state.permissionPurpose}` : ""}
    </p>

    <div className="mt-2 flex flex-wrap gap-2">
      {state.outstandingDeviceEvent && status !== "REVOKED" && <button type="button" onClick={() => void revoke()} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
        {busy === "revoke" ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}撤销提醒并移除日程
      </button>}
      {(status === "FAILED" || status === "MISSING") && <button type="button" onClick={() => void retryDeviceWrite()} disabled={busy !== null} className="focus-ring editorial-button-secondary text-xs disabled:opacity-50">
        {busy === "retry" ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}记录为待重试
      </button>}
      {status === "SYNCED" && <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--teal-pale)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--teal-strong)]"><Check size={13} />设备日历已写入</span>}
    </div>
  </div>;
}
