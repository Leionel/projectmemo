"use client";
import styles from "./MissionPanel.module.css";

type EventPayload = { title?: string; description?: string; startAt?: string; endAt?: string; timeZone?: string; allDay?: boolean; recurrence?: string | null;
  attendees?: unknown[]; attachments?: string[] };
type CalendarItem = { index?: number; marker?: string; payload?: EventPayload };
type CalendarProposal = {
  id: string; proposalHash: string; expiresAt: string;
  proposal: { tool: string; compensationPolicy?:string; args?: { events?: CalendarItem[] } & Record<string, unknown>; payload?: EventPayload;
    target?: { accountName?: string; accountEmail?: string; calendarSummary?: string; calendarId?: string; authGeneration?: number; connectionRevision?: number };
    marker?: string; effectQuery?: { marker?: string; timeMin?: string; timeMax?: string }; events?: CalendarItem[] };
};
function formatCalendarTime(value?:string,zone?:string){try{return new Intl.DateTimeFormat("zh-CN",{timeZone:zone,dateStyle:"short",timeStyle:"short"}).format(new Date(value??""));}catch{return value??"?";}}
const when = (payload: EventPayload) => payload.allDay
  ? `${payload.startAt ?? "?"} 至 ${payload.endAt ?? "?"}（全天）`
  : `${formatCalendarTime(payload.startAt,payload.timeZone) ?? "?"} → ${formatCalendarTime(payload.endAt,payload.timeZone) ?? "?"}（${payload.timeZone ?? "?"}）`;
const extras = (payload: EventPayload) => [
  payload.attendees?.length ? `参与人 ${payload.attendees.map(v=>{const a=v as {email?:string;openId?:string};return a.email??a.openId??"身份待核对";}).join("、")}` : "", payload.attachments?.length ? `附件 ${payload.attachments.join("、")}` : "",
  payload.recurrence ? `重复 ${payload.recurrence}` : "",
].filter(Boolean).join(" · ");
export function CalendarProposalPreview({preview}:{preview:import("@/lib/types").CalendarApprovalPreview}){
 return <div><p>{preview.target.accountName||preview.target.accountEmail} · {preview.target.calendarSummary||preview.target.calendarId}</p><p>{when(preview.payload)}</p><p>{extras(preview.payload)}</p><pre className="whitespace-pre-wrap break-words text-xs">{preview.payload.description}</pre><p>{preview.compensationPolicy==="RECHECK_THEN_DELETE_CREATED_EVENTS"?"批准包含创建、添加上述参与人和失败补偿删除；补偿前重新读取核对，发现变化、停止或撤权则保留待核对。不发送参与人通知。先读后删与飞书编辑不原子互斥，核对后立即发生的编辑仍可能被删除。":"本提案不包含自动删除许可。"}</p></div>;
}
export function CalendarEventApproval({ approval, busy, checkedAt, onDecision }: { approval: CalendarProposal; busy: boolean; checkedAt: number;
  onDecision: (decision: "APPROVED" | "REJECTED") => void }) {
  const target = approval.proposal.target ?? {};
  const expired = checkedAt > 0 && Date.parse(approval.expiresAt) <= checkedAt;
  const events = approval.proposal.events ?? [];
  const batch = approval.proposal.tool === "create_calendar_events" && events.length > 0;
  if (batch) return <section className={styles.attention} aria-label="待批准的外部日历批量写入">
    <h4>等待你批准飞书日历批量写入</h4>
    <p>{approval.proposal.compensationPolicy==="RECHECK_THEN_DELETE_CREATED_EVENTS"?"批准包含本批创建、参与人添加及失败补偿删除；补偿前重新读取核对，停止或撤权后不再写入。先读后删与飞书编辑不原子互斥，核对后发生的编辑仍可能被删除。":"本提案不包含自动删除许可。"}</p>
    <p>将在 <strong>{target.accountName || target.accountEmail || "已连接账号"}</strong> 的日历 <strong>{target.calendarSummary || target.calendarId}</strong> 创建 {events.length} 个日程。失败时按上述批准范围处理；结果会写入回执。</p>
    {events.map(item => <dl className={styles.completionFacts} key={item.index ?? item.marker}>
      <div><dt>日程 {(item.index ?? 0) + 1}</dt><dd>{item.payload?.title}</dd></div>
      <div><dt>时间</dt><dd>{when(item.payload ?? {})}</dd></div>
      {item.payload?.description && <div><dt>日程描述</dt><dd className="whitespace-pre-wrap break-words">{item.payload.description}</dd></div>}
      {extras(item.payload ?? {}) && <div><dt>范围</dt><dd>{extras(item.payload ?? {})}</dd></div>}
    </dl>)}
    <p className={styles.muted}>批准只对上面这一批内容有效，改动任何一项都需要重新预览。批准有效至：{new Date(approval.expiresAt).toLocaleString("zh-CN")}。</p>
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
    <p>{approval.proposal.compensationPolicy==="RECHECK_THEN_DELETE_CREATED_EVENTS"?"批准包含：创建、添加上述参与人，以及失败时重新核对本次日程后补偿删除；不发送参与人通知。先读后删与飞书编辑不原子互斥，核对后立即发生的编辑仍可能被删除。":"本提案不包含自动删除许可。"}</p>
    <p>将在 <strong>{target.accountName || target.accountEmail || "已连接账号"}</strong> 的日历 <strong>{target.calendarSummary || target.calendarId}</strong> 创建 1 个日程。参与人核对失败时，先重读核对再删除本次日程；撤权或停止后不再补偿写入。</p>
    <dl className={styles.completionFacts}>
      <div><dt>标题</dt><dd>{payload.title}</dd></div>
      <div><dt>时间</dt><dd>{when(payload)}</dd></div>
      {extras(payload) && <div><dt>范围</dt><dd>{extras(payload)}</dd></div>}
    </dl>
    {payload.description && <><p className={styles.muted}>日程描述</p><pre className="whitespace-pre-wrap break-words text-sm">{payload.description}</pre></>}
    {marker && <p className={styles.muted}>结果不确定时只查询，不会重复创建。</p>}
    <p className={styles.muted}>批准只对上面的内容有效，改动任何一项都需要重新预览。批准有效至：{new Date(approval.expiresAt).toLocaleString("zh-CN")}。</p>
    {expired && <p role="status">提案已过期，请更新依据并重新预览。</p>}
    <div className={styles.actions}>
      <button className={styles.primary} disabled={busy || checkedAt === 0 || expired} onClick={() => onDecision("APPROVED")}>批准创建日程</button>
      <button disabled={busy} onClick={() => onDecision("REJECTED")}>拒绝</button>
    </div>
  </section>;
}
