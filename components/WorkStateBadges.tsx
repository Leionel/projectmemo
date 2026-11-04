import type { WorkState } from "@/lib/types/workState";
import { stopRequestBadge, workStateLabel, workTone } from "@/lib/client/workStateBadge";
import styles from "./WorkStateBadges.module.css";

/** 委托阶段徽标 + 并列的停止请求徽标；颜色只来自 globals.css 变量，深色模式随之切换。 */
export function WorkStateBadges({ state }: { state: Pick<WorkState, "phase" | "terminal" | "stopRequest"> }) {
  const tone = workTone(state), stop = stopRequestBadge(state);
  return <span className={styles.group}>
    <span className={styles.badge} data-tone={tone}>{["user", "agent", "observing", "paused", "failed"].includes(tone) && <span className={styles.dot} aria-hidden="true"/>}{workStateLabel(state)}</span>
    {stop && <span className={styles.badge} data-tone="system">{stop}</span>}
  </span>;
}
