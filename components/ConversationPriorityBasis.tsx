"use client";
import { Fragment } from "react";
import type { PriorityReason } from "@/lib/types/conversation";
import { presentPriority } from "@/lib/conversation/priorityPresentation";
import styles from "./ConversationPanel.module.css";

/** 「判断依据」展开区域：已知事实、未知与依据来源分开列出；由消息工具栏控制展开。 */
export function PriorityBasisPanel({ priorities, projects }: {
  priorities: PriorityReason[]; projects: Array<{ id: string; title: string }>;
}) {
  if (!priorities.length) return null;
  return <div className={styles.priorityBasis} role="region" aria-label="判断依据">
    <ul>
      {priorities.map(p => {
        const view = presentPriority(p);
        const title = projects.find(v => v.id === p.projectId)?.title ?? "项目";
        return <Fragment key={p.projectId}>
          {view.headlines.map((line, i) => <li key={i}>{priorities.length > 1 && i === 0 ? title + " · " : ""}{line}</li>)}
        </Fragment>;
      })}
    </ul>
    {priorities.map(p => { const view = presentPriority(p);
      return <div key={p.projectId} className={styles.priorityDetail}>
        <p className={styles.priorityBasisLabel}>{view.basis}</p>
        {view.detail.map((line, i) => <p key={i}>{line}</p>)}
      </div>; })}
  </div>;
}
