"use client";
import { useCallback, useEffect, useState } from "react";

type Connection = { id: string; provider: string; accountEmail: string; accountName: string; calendarId: string; calendarSummary: string; calendarTimeZone: string;
  accessRole: string; scope: string; status: string; revokedAt: string | null; lastFetchedAt: string | null; lastStatus: string | null; lastError: string | null; revision: number; connected: boolean };
const label = (connection: Connection) => connection.accountName || connection.accountEmail || "飞书账号";
const statusText = (connection: Connection) => connection.status === "REVOKED" ? "已断开" : connection.lastStatus === "REAUTH_REQUIRED" ? "需要重新授权" : connection.lastStatus === "UNKNOWN" ? "上次刷新结果未知" : connection.lastFetchedAt ? "已连接" : "已连接，尚未读取日程";

export function CalendarConnectionsCard({ projectId, enabled }: { projectId: string; enabled: boolean }) {
  const [connections, setConnections] = useState<Connection[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/projects/${projectId}/calendar-connections`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error?.message ?? "无法读取日历连接");
    setConnections(body.connections ?? []);
  }, [projectId]);
  const failLoad = useCallback((e: unknown) => setError(e instanceof Error ? e.message : "无法读取日历连接"), []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- state is applied only after the server response resolves.
  useEffect(() => { if (enabled) void load().catch(failLoad); }, [enabled, load, failLoad]);
  if (!enabled) return null;
  const connect = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/calendar-connections`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "无法开始飞书日历授权");
      if (!body.authorizationUrl) throw new Error("授权地址缺失");
      window.location.assign(body.authorizationUrl);
    } catch (e) { setError(e instanceof Error ? e.message : "无法开始飞书日历授权"); setBusy(false); }
  };
  const revoke = async (connection: Connection) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/calendar-connections/${connection.id}`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVOKE", requestId: crypto.randomUUID() }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "无法断开日历");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "无法断开日历"); } finally { setBusy(false); }
  };
  return <details className="editorial-card" id="calendar-connections">
    <summary className="cursor-pointer text-base font-semibold">飞书日历只读连接</summary>
    <p className="mt-2 text-sm text-ink-secondary">只读取所选日历的日程时间与标题，用于核对项目期限和冲突。不会创建、修改或发送任何日程；断开后历史快照保留但不再用于当前判断。</p>
    {error ? <p role="alert" className="mt-3 text-sm">{error}</p> : null}
    <div className="mt-4 space-y-3">
      {connections.length === 0 ? <p className="text-sm text-ink-secondary">尚未连接飞书日历。</p> : connections.map(connection => <div key={connection.id} className="rounded border border-[var(--line)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-medium">{connection.calendarSummary || connection.calendarId}</p>
            <p className="text-sm text-ink-secondary">{label(connection)} · {connection.calendarTimeZone} · {connection.accessRole} · {statusText(connection)}</p>
          </div>
          {connection.connected ? <button type="button" disabled={busy} onClick={() => void revoke(connection)} className="editorial-button-secondary">断开连接</button> : null}
        </div>
        <p className="mt-2 text-xs text-ink-secondary">权限：{connection.scope.includes("calendar:calendar:readonly") ? "读取日历与日程" : "未知"}；离线刷新{connection.scope.includes("offline_access") ? "已允许" : "未允许"}。{connection.lastError ? ` ${connection.lastError}` : ""}</p>
      </div>)}
    </div>
    {connections.some(connection => connection.connected) ? null : <button type="button" disabled={busy} onClick={() => void connect()} className="editorial-button-secondary mt-4">{busy ? "正在准备授权…" : "连接飞书日历"}</button>}
  </details>;
}
