import type { ProjectStateDiff, SnapshotEvidenceRef } from "@/lib/types/projectState";
import { diffMeta } from "@/lib/client/projectStateView";

const evidenceKindLabels: Record<SnapshotEvidenceRef["entityKind"], string> = {
  card: "记忆",
  action: "行动",
  deliverable: "交付物",
  attachment: "附件",
};

const toneClass: Record<string, string> = {
  ok: "text-[var(--teal-strong)]",
  bad: "text-[var(--brick)]",
  warn: "text-[var(--amber)]",
  muted: "text-[var(--muted)]",
  brand: "text-[var(--navy)]",
};

/** 状态变化的只读列表：状态卡「查看全部变化」与会议导入「会后对比」共用同一套读法 */
export function StateDiffView({ diff, limit, emptyText = "没有需要处理的变化。" }: { diff: ProjectStateDiff; limit?: number; emptyText?: string }) {
  const items = limit ? diff.items.slice(0, limit) : diff.items;
  if (items.length === 0) {
    return <p className="rounded-lg bg-[var(--paper-strong)] px-3 py-2.5 text-xs leading-5 text-[var(--muted)]">{emptyText}</p>;
  }
  return <ul className="space-y-2">
    {items.map((item) => {
      const meta = diffMeta(item.kind);
      return <li key={item.changeKey} className="rounded-xl border border-[var(--rule)] bg-[var(--card-bg)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className={"text-sm font-black " + toneClass[meta.tone]}>{meta.glyph}</span>
          <span className="rounded-md bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ink-soft)]">{meta.label}</span>
          <span className="text-[11px] font-bold text-[var(--muted)]">依据 {item.evidenceRefs.length} 项</span>
        </div>
        <p className="mt-1.5 text-xs font-semibold leading-5 text-[var(--navy)]">{item.summary}</p>
        {(item.before !== null || item.after !== null) && <p className="mt-1 text-[11px] leading-5 text-[var(--ink-soft)]">
          {item.before !== null && <span className="line-through opacity-70">{item.before}</span>}
          {item.before !== null && item.after !== null && <span aria-hidden="true" className="mx-1.5 text-[var(--muted)]">→</span>}
          {item.after !== null && <span className="font-bold">{item.after}</span>}
        </p>}
        {item.evidenceRefs.length > 0 && <p className="mt-1.5 flex flex-wrap gap-1.5">
          {item.evidenceRefs.slice(0, 4).map((ref, index) => <span key={`${ref.entityKind}-${ref.entityId}-${index}`} className="rounded bg-[var(--paper-strong)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--teal-strong)]">
            {evidenceKindLabels[ref.entityKind] ?? ref.entityKind} · {ref.field || "版本证据"}
          </span>)}
          {item.evidenceRefs.length > 4 && <span className="px-1 py-0.5 text-[10px] text-[var(--muted)]">+{item.evidenceRefs.length - 4}</span>}
        </p>}
      </li>;
    })}
    {limit && diff.items.length > limit && <li className="px-1 text-[11px] font-semibold text-[var(--muted)]">还有 {diff.items.length - limit} 项变化</li>}
  </ul>;
}
