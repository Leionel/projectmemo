"use client";

import { BookOpen, FilePlus2, FileX2, Pencil, Link2 } from "lucide-react";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import type { WorkbenchOutput, WorkbenchSource } from "@/lib/types/workbench";
import { workbenchChangeLabels, workbenchChanges } from "@/lib/mission/workbenchComparison";
import styles from "./RevisionComparison.module.css";

type Block = WorkbenchOutput["blocks"][number];
export type OpenRevisionSource = (source: WorkbenchSource, citedAt: string, excerpt?: string) => void;
export function RevisionComparison({ baseline, output, sources, onOpenSource, feedbackSourceId, onClearFilter }: {
  baseline: WorkbenchOutput;
  output: WorkbenchOutput;
  sources: WorkbenchSource[];
  onOpenSource: OpenRevisionSource;
  feedbackSourceId?: string;
  onClearFilter: () => void;
}) {
  const restricted = baseline.sourceAccessChanged || output.sourceAccessChanged;
  const allChanges = restricted ? [] : workbenchChanges(baseline, output, sources);
  const changes = feedbackSourceId ? allChanges.filter(change => change.afterSources.some(source => source.id === feedbackSourceId)) : allChanges;
  const icons = { added: FilePlus2, edited: Pencil, removed: FileX2, sources: Link2 };

  function citationButtons(refs: WorkbenchSource[], version: WorkbenchOutput, block: Block) {
    return refs.map(source => <button type="button" key={source.key} onClick={() => onOpenSource(source, version.createdAt, block.text)}>
      <BookOpen size={15} aria-hidden />{sourceDisplayName(source.id, source.name)}
    </button>);
  }

  return <section className={styles.comparison} aria-label="版本修改对照">
    <header>
      <h2>第 {baseline.revision} 版 → 第 {output.revision} 版</h2>
      {!restricted && <span>{changes.length ? changes.length + " 处变化" : "无可见变化"}</span>}
    </header>
    {restricted && <p className={styles.empty}>部分原始依据的使用许可已变化，当前无法核对这两版差异。</p>}
    {feedbackSourceId && <div className={styles.filter}><span><Link2 size={16} aria-hidden />查看引用这次反馈的改动</span>
      <button type="button" onClick={onClearFilter}>查看全部改动</button></div>}
    {!restricted && (changes.length ? <ol>{changes.map(change => {
      const Icon = icons[change.kind];
      return <li key={change.id}>
        <h3><Icon size={16} aria-hidden />{workbenchChangeLabels[change.kind]}</h3>
        <div className={styles.pair}>
          {change.before && <div className={styles.before}>
            <p>第 {baseline.revision} 版 <time dateTime={baseline.createdAt}>{evidenceTime(baseline.createdAt, true)}</time></p>
            <del>{change.before.text}</del>
            {citationButtons(change.beforeSources, baseline, change.before)}
          </div>}
          {change.after && <div className={styles.after}>
            <p>第 {output.revision} 版 <time dateTime={output.createdAt}>{evidenceTime(output.createdAt, true)}</time></p>
            <ins>{change.after.text}</ins>
            {citationButtons(change.afterSources, output, change.after)}
          </div>}
        </div>
      </li>;
    })}</ol> : <p className={styles.empty}>{feedbackSourceId ? "当前没有可读且引用这次反馈的改动。" : "这两版可读的正文和引用一致。"}</p>)}
  </section>;
}
