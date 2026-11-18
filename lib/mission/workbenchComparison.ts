import type { WorkbenchOutput, WorkbenchSource } from "@/lib/types/workbench";

type Block = WorkbenchOutput["blocks"][number];
export type WorkbenchChange = {
  id: string;
  kind: "added" | "edited" | "removed" | "sources";
  before?: Block;
  after?: Block;
  beforeSources: WorkbenchSource[];
  afterSources: WorkbenchSource[];
};

export const workbenchChangeLabels = { added: "新增", edited: "改写", removed: "移除", sources: "仅依据变化" };

export function blockSources(output: WorkbenchOutput, block: Block, sources: WorkbenchSource[]) {
  return sources.filter(source => output.sourceKeys.includes(source.key) && block.sourceIds.includes(source.id));
}

export function workbenchChanges(baseline: WorkbenchOutput, output: WorkbenchOutput, sources: WorkbenchSource[]): WorkbenchChange[] {
  const oldBlocks = new Map(baseline.blocks.map(block => [block.blockId, block]));
  const newIds = new Set(output.blocks.map(block => block.blockId));
  const changes = output.blocks.flatMap<WorkbenchChange>(block => {
    const before = oldBlocks.get(block.blockId);
    const afterSources = blockSources(output, block, sources);
    const beforeSources = before ? blockSources(baseline, before, sources) : [];
    const sameSources = beforeSources.length === afterSources.length &&
      beforeSources.every(source => afterSources.some(current => current.key === source.key));
    const sameBlock = before?.text === block.text && before.kind === block.kind;
    if (sameBlock && sameSources) return [];
    return [{ id: block.blockId, before, after: block, beforeSources, afterSources,
      kind: !before ? "added" : sameBlock ? "sources" : "edited" }];
  });
  for (const block of baseline.blocks) {
    if (newIds.has(block.blockId)) continue;
    changes.push({ id: block.blockId, before: block, beforeSources: blockSources(baseline, block, sources), afterSources: [], kind: "removed" });
  }
  return changes;
}
