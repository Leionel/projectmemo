"use client";

import { BookOpen, FilePlus2, FileX2, Pencil, Link2 } from "lucide-react";
import { evidenceTime, sourceDisplayName } from "@/lib/client/sourceDisplay";
import type { WorkbenchOutput, WorkbenchSource } from "@/lib/types/workbench";
import styles from "./RevisionComparison.module.css";

type Block = WorkbenchOutput["blocks"][number];
export type OpenRevisionSource = (source: WorkbenchSource, citedAt: string, excerpt?: string) => void;
type Change = {
  id: string;
  kind: "added" | "edited" | "removed" | "sources";
  before?: Block;
  after?: Block;
  beforeSources: WorkbenchSource[];
  afterSources: WorkbenchSource[];
};

function references(output: WorkbenchOutput, block: Block, sources: WorkbenchSource[]) {
  return sources.filter(source => output.sourceKeys.includes(source.key) && block.sourceIds.includes(source.id));
}

export function RevisionComparison({ baseline, output, sources, onOpenSource }: {
  baseline: WorkbenchOutput;
  output: WorkbenchOutput;
  sources: WorkbenchSource[];
  onOpenSource: OpenRevisionSource;
}) {
  const oldBlocks = new Map(baseline.blocks.map(block => [block.blockId, block]));
  const newIds = new Set(output.blocks.map(block => block.blockId));
  const changes = output.blocks.flatMap<Change>(block => {
    const before = oldBlocks.get(block.blockId);
    const afterSources = references(output, block, sources);
    const beforeSources = before ? references(baseline, before, sources) : [];
    const sameSources = beforeSources.length === afterSources.length &&
      beforeSources.every(source => afterSources.some(current => current.key === source.key));
    if (before && before.text === block.text && before.kind === block.kind && sameSources) return [];
    const kind = !before ? "added" : before.text === block.text && before.kind === block.kind ? "sources" : "edited";
    return [{ id: block.blockId, before, after: block, beforeSources, afterSources, kind }];
  });
  for (const block of baseline.blocks) {
    if (!newIds.has(block.blockId)) {
      changes.push({ id: block.blockId, before: block, beforeSources: references(baseline, block, sources), afterSources: [], kind: "removed" });
    }
  }
  const labels = {
    added: { label: "新增", icon: FilePlus2 },
    edited: { label: "改写", icon: Pencil },
    removed: { label: "移除", icon: FileX2 },
    sources: { label: "仅依据变化", icon: Link2 },
  };

  function citationButtons(refs: WorkbenchSource[], version: WorkbenchOutput, block: Block) {
    return refs.map(source => <button type="button" key={source.key} onClick={() => onOpenSource(source, version.createdAt, block.text)}>
      <BookOpen size={15} aria-hidden />{sourceDisplayName(source.id, source.name)}
    </button>);
  }

  return <section className={styles.comparison} aria-label="版本修改对照">
    <header>
      <h2>第 {baseline.revision} 版 → 第 {output.revision} 版</h2>
      <span>{changes.length ? changes.length + " 处变化" : "无可见变化"}</span>
    </header>
    {changes.length ? <ol>{changes.map(change => {
      const { label, icon: Icon } = labels[change.kind];
      return <li key={change.id}>
        <h3><Icon size={16} aria-hidden />{label}</h3>
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
    })}</ol> : <p className={styles.empty}>这两版可读的正文和引用一致。</p>}
  </section>;
}
