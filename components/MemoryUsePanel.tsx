"use client";
import Link from "next/link";
import type { ConversationMemoryUseItem } from "@/lib/types/conversation";
import styles from "./ConversationPanel.module.css";

const kindLabels: Record<ConversationMemoryUseItem["kind"], string> = { PERSONAL: "你的偏好", JUDGMENT: "项目判断", EXPERIENCE: "项目经验" };

/** 本轮提供给调查参考的记忆：按当前状态展示，失效的条目变灰；管理入口回到原页面，不在这里改记忆。 */
export function MemoryUsePanel({ items }: { items: ConversationMemoryUseItem[] }) {
  const projectId = items.find(item => item.projectId)?.projectId;
  return <section className={styles.memoryUse} aria-label="本轮参考的记忆">
    <h4>本轮提供参考的记忆</h4>
    <ul>
      {items.map(item => <li key={item.kind + item.id} className={item.active ? undefined : styles.memoryUseInactive}>
        <span className={styles.memoryUseMeta}>{kindLabels[item.kind]} · {item.stateLabel}{item.changedSince ? " · 之后已更新" : ""}</span>
        <span>{item.title}</span>
      </li>)}
    </ul>
    <div className={styles.memoryUseLinks}>
      {items.some(item => item.kind === "PERSONAL") && <Link prefetch={false} className="workspace-link focus-ring" href="/settings/memory">管理我的记忆</Link>}
      {projectId && <Link prefetch={false} className="workspace-link focus-ring" href={`/projects/${encodeURIComponent(projectId)}/knowledge`}>查看项目判断与经验</Link>}
    </div>
  </section>;
}
