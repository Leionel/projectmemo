"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import styles from "./MissionPanel.module.css";

type Hypothesis = {
  id: string; statement: string; effectiveStatus: string; sourceMissionId: string | null;
  history: Array<{ revision: number; at: string; statement?: string; state?: string }>;
  evidence: Array<{ role: string; quote?: string; qualified: boolean }>;
};
const statusLabels: Record<string, string> = { PROPOSED: "待核实", INVESTIGATING: "调查中", SUPPORTED: "有条件支持", REFUTED: "发现反例", INCONCLUSIVE: "尚无结论", EXPIRED: "需要重核", RESTRICTED: "暂不可读" };
const label = (state?: string) => statusLabels[state ?? ""] ?? "待核实";

/**
 * 这条委托形成的判断如何随新证据改变：读取原项目判断投影，只列出本委托产生且已修订或被推翻的条目。
 * 判断是有条件的模型评估，不是事实认证；详情与纠正回到项目判断页。
 */
export function MissionJudgmentChanges({ projectId, missionId, missionVersion }: { projectId: string; missionId: string; missionVersion: number }) {
  const [items, setItems] = useState<Hypothesis[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/agent-memory`, { signal: AbortSignal.timeout(25000) })
      .then(r => r.ok ? r.json() : null)
      .then((v: { hypotheses?: { items?: Hypothesis[] } } | null) => { if (live) setItems(v?.hypotheses?.items ?? null); })
      .catch(() => { if (live) setItems(null); });
    return () => { live = false; };
  }, [projectId, missionId, missionVersion]);
  const changed = (items ?? []).filter(h => h.sourceMissionId === missionId && (h.history.length > 1 || ["REFUTED", "INCONCLUSIVE", "EXPIRED"].includes(h.effectiveStatus)));
  if (!changed.length) return null;
  return <section className={styles.judgmentChanges} aria-label="判断变化">
    <h3 className={styles.sectionTitle}>判断变化</h3>
    <ul>
      {changed.slice(0, 3).map(h => {
        const previous = h.history[1], counters = h.evidence.filter(e => e.role === "COUNTER" && e.qualified).length;
        return <li key={h.id}>
          <p className={styles.judgmentState}>
            {previous ? <>{label(previous.state)} → <strong>{label(h.effectiveStatus)}</strong></> : <strong>{label(h.effectiveStatus)}</strong>}
            {h.history[0] && <time dateTime={h.history[0].at}> · {new Date(h.history[0].at).toLocaleString("zh-CN", { hour12: false })}</time>}
          </p>
          <p>{h.statement}</p>
          {previous?.statement && previous.statement !== h.statement && <p className={styles.judgmentPrevious}>原判断：{previous.statement}</p>}
          {counters > 0 && <p className={styles.stepHint}>{counters} 处反例来自已核对的原文</p>}
        </li>;
      })}
    </ul>
    <Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${encodeURIComponent(projectId)}/knowledge`}>查看判断依据与纠正</Link>
  </section>;
}
