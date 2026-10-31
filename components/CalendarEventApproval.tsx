"use client";
import styles from "./MissionPanel.module.css";

type EventPayload = { title?: string; description?: string; startAt?: string; endAt?: string; timeZone?: string; allDay?: boolean; recurrence?: string | null;
  attendees?: unknown[]; attachments?: string[] };
type CalendarItem = { index?: number; marker?: string; payload?: EventPayload };
type CalendarProposal = {
  id: string; proposalHash: string; expiresAt: string;
  proposal: { tool: string; args?: { events?: CalendarItem[] } & Record<string, unknown>; payload?: EventPayload;
    target?: { accountName?: string; accountEmail?: string; calendarSummary?: string; calendarId?: string; authGeneration?: number; connectionRevision?: number };
    marker?: string; effectQuery?: { marker?: string; timeMin?: string; timeMax?: string }; events?: CalendarItem[] };
};
const when = (payload: EventPayload) => payload.allDay
  ? `${payload.startAt ?? "?"} 至 ${payload.endAt ?? "?"}（全天）`
  : `${payload.startAt?.slice(0, 16).replace("T", " ") ?? "?"} → ${payload.endAt?.slice(0, 16).replace("T", " ") ?? "?"}（${payload.timeZone ?? "?"}）`;
const extras = (payload: EventPayload) => [
  payload.attendees?.length ? `参与人 ${payload.attendees.length}` : "", payload.attachments?.length ? `附件 ${payload.attachments.length}` : "",
  payload.recurrence ? `重复 ${payload.recurrence}` : "",
].filter(Boolean).join(" · ");
export function CalendarEventApproval({ approval, busy, checkedAt, onDecision }: { approval: CalendarProposal; busy: boolean; checkedAt: number;
  onDecision: (decision: "APPROVED" | "REJECTED") => void }) {
  const target = approval.proposal.target ?? {};
  const expired = checkedAt > 0 && Date.parse(approval.expiresAt) <= checkedAt;
  const events = approval.proposal.events ?? [];
  const batch = approval.proposal.tool === "create_calendar_events" && events.length > 0;
  if (batch) return <section className={styles.attention} aria-label="待批准的外部日历批量写入">
    <h4>等待你批准飞书日历批量写入</h4>
    <p>将在 <strong>{target.accountName || target.accountEmail || "已连接账号"}</strong> 的日历 <strong>{target.calendarSummary || target.calendarId}</strong> 创建 {events.length} 个日程。任一失败会删除本批次已创建的日程作为补偿；补偿结果会写入回执。</p>
    {events.map(item => <dl className={styles.completionFacts} key={item.index ?? item.marker}>
      <div><dt>日程 {(item.index ?? 0) + 1}</dt><dd>{item.payload?.title}</dd></div>
      <div><dt>时间</dt><dd>{when(item.payload ?? {})}</dd></div>
      {extras(item.payload ?? {}) && <div><dt>范围</dt><dd>{extras(item.payload ?? {})}</dd></div>}
    </dl>)}
    <p className={styles.muted}>批准范围仅限上述账号、日历和完整批次 payload；修改任何字段都必须重新预览并批准。批准有效至：{new Date(approval.expiresAt).toLocaleString("zh-CN")}。</p>
    {expired && <p role="status">提案已过期，请更新依据并重新预览。</p>}
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || checkedAt === 0 || expired} onClick={() => onDecision("APPROVED")}>批准创建本批日程</button>
      <button disabled={busy} onClick={() => onDecision("REJECTED")}>拒绝</button>
    </div>
  </section>;
  const payload = approval.proposal.payload ?? (approval.proposal.args as CalendarProposal["proposal"]["payload"]) ?? {};
  const marker = approval.proposal.marker ?? approval.proposal.effectQuery?.marker ?? "";
  return <section className={styles.attention} aria-label="待批准的外部日历写入">
    <h4>等待你批准飞书日历写入</h4>
    <p>将在 <strong>{target.accountName || target.accountEmail || "已连接账号"}</strong> 的日历 <strong>{target.calendarSummary || target.calendarId}</strong> 创建 1 个日程。创建后不会自动删除或回滚。</p>
    <dl className={styles.completionFacts}>
      <div><dt>标题</dt><dd>{payload.title}</dd></div>
      <div><dt>时间</dt><dd>{when(payload)}</dd></div>
      {extras(payload) && <div><dt>范围</dt><dd>{extras(payload)}</dd></div>}
    </dl>
    {payload.description && <><p className={styles.muted}>外发描述（含服务端操作标记）</p><pre className="whitespace-pre-wrap break-words text-sm">{payload.description}</pre></>}
    {marker && <p className={styles.muted}>效果核对标记：<code className="break-all">{marker}</code>。服务端同时使用飞书原生 idempotency_key；回包丢失时只查询原效果，不自动再创建，也不宣称 exactly-once。</p>}
    <p className={styles.muted}>批准范围仅限上述账号、日历和完整 payload；修改任何字段都必须重新预览并批准。批准有效至：{new Date(approval.expiresAt).toLocaleString("zh-CN")}。</p>
    {expired && <p role="status">提案已过期，请更新依据并重新预览。</p>}
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || checkedAt === 0 || expired} onClick={() => onDecision("APPROVED")}>批准创建日程</button>
      <button disabled={busy} onClick={() => onDecision("REJECTED")}>拒绝</button>
    </div>
  </section>;
}
