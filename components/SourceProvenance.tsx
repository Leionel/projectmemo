import { CalendarDays, CheckCircle2, ChevronRight, Clock3, FileText, Globe2, History } from "lucide-react";
import { evidenceTime } from "@/lib/client/sourceDisplay";
import styles from "./SourceProvenance.module.css";
export function SourceProvenance({ name, observedAt, referencedAt, current, external = false, timeLabel = "记录时间", technical = [] }: {
  name: string; observedAt?: string | null; referencedAt?: string | null; current?: boolean; external?: boolean; timeLabel?: string;
  technical?: Array<{ label: string; value: string | null | undefined }>;
}) {
  const Icon = external ? Globe2 : FileText;
  return <section className={styles.provenance} aria-label="来源信息">
    <header><Icon size={16} aria-hidden="true" /><strong>{name}</strong></header>
    {current !== undefined && <p className={styles.status} data-current={current}>{current ? <CheckCircle2 size={14} aria-hidden="true" /> : <History size={14} aria-hidden="true" />}
      {current ? "当前引用版本" : "此前引用的版本"}</p>}
    <dl><div><dt><CalendarDays size={16} aria-hidden="true" />{timeLabel}</dt><dd><time dateTime={observedAt || undefined}>{evidenceTime(observedAt)}</time></dd></div>
      {referencedAt && <div><dt><Clock3 size={16} aria-hidden="true" />本稿引用时间</dt><dd><time dateTime={referencedAt}>{evidenceTime(referencedAt)}</time></dd></div>}
    </dl>
    {technical.some(item => item.value) && <details><summary><ChevronRight size={14} aria-hidden="true" />技术信息</summary><dl>
      {technical.filter(item => item.value).map(item => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
    </dl></details>}
  </section>;
}
