"use client";
import styles from "./MissionPanel.module.css";

type CalendarProposal = {
  id: string; proposalHash: string; expiresAt: string;
  proposal: { tool: string; args?: Record<string, unknown>; payload?: { title?: string; description?: string; startAt?: string; endAt?: string; timeZone?: string };
    target?: { accountName?: string; accountEmail?: string; calendarSummary?: string; calendarId?: string; authGeneration?: number; connectionRevision?: number };
    marker?: string; effectQuery?: { marker?: string; timeMin?: string; timeMax?: string } };
};
export function CalendarEventApproval({ approval, busy, checkedAt, onDecision }: { approval: CalendarProposal; busy: boolean; checkedAt: number;
  onDecision: (decision: "APPROVED" | "REJECTED") => void }) {
  const payload = approval.proposal.payload ?? (approval.proposal.args as CalendarProposal["proposal"]["payload"]) ?? {};
  const target = approval.proposal.target ?? {};
  const marker = approval.proposal.marker ?? approval.proposal.effectQuery?.marker ?? "";
  const expired = checkedAt > 0 && Date.parse(approval.expiresAt) <= checkedAt;
  return <section className={styles.attention} aria-label="待批准的外部日历写入">
    <h4>等待你批准飞书日历写入</h4>
    <p>将在 <strong>{target.accountName || target.accountEmail || "已连接账号"}</strong> 的日历 <strong>{target.calendarSummary || target.calendarId}</strong> 创建 1 个日程。创建后不会自动删除或回滚。</p>
    <dl className={styles.completionFacts}>
      <div><dt>标题</dt><dd>{payload.title}</dd></div>
      <div><dt>时间</dt><dd>{payload.startAt?.slice(0, 16).replace("T", " ")} → {payload.endAt?.slice(0, 16).replace("T", " ")}</dd></div>
      <div><dt>时区</dt><dd>{payload.timeZone}</dd></div>
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
