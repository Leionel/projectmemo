import type { DecisionSnapshot } from "./snapshot";
export type DependencyState = "MET" | "UNMET" | "UNKNOWN";
export type ImpactKind =
  "SUPPORT_CHANGED" | "NEEDS_REVIEW" | "HARD_PREREQUISITE_UNMET" | "PLAN_STALE";
export type ImpactEdge = {
  from: string;
  to: string;
  kind: string;
  hard: boolean;
  fromTitle?: string;
  toTitle?: string;
};
export type ImpactItem = {
  target: string;
  title: string;
  kind: ImpactKind;
  path: ImpactEdge[];
  state: DependencyState;
  historical: boolean;
};
type Block = { blockId?: string; sourceIds?: string[]; cardIds?: string[] };
function blocks(value: unknown): Block[] {
  if (Array.isArray(value)) return value as Block[];
  if (value && typeof value === "object") {
    const v = value as { blocks?: Block[]; claims?: Block[] };
    return v.blocks ?? v.claims ?? [];
  }
  return [];
}
export function assessImpact(s: DecisionSnapshot, rootIds: string[]) {
  const historicalBlocks = new Set<string>(),
    inactiveEdges = new Set<ImpactEdge>();
  const edges: ImpactEdge[] = [],
    titles = new Map<string, string>(),
    stateCache = new Map<string, DependencyState>();
  let cycle = false;
  const add = (from: string, to: string, kind: string, hard = false) =>
    edges.push({ from, to, kind, hard });
  titles.set(`project:${s.project.id}`, s.project.title);
  const cardState = new Map(s.cardStates.map((c) => [c.id, c.state]));
  for (const capture of s.captures)
    titles.set(`capture:${capture.id}`, "原始记录");
  for (const attachment of s.attachments)
    titles.set(`attachment:${attachment.id}`, attachment.fileName);
  for (const c of s.cards) {
    titles.set(`card:${c.id}`, c.title);
    add(`capture:${c.captureId}`, `card:${c.id}`, "CARD_SOURCE");
    if (c.attachmentId)
      add(`attachment:${c.attachmentId}`, `card:${c.id}`, "CARD_SOURCE");
  }
  for (const r of s.relations.filter((r) => r.confirmed && r.confirmedAt)) {
    if (r.relationType === "SUPPORTS")
      add(
        `card:${r.currentCard.id}`,
        `card:${r.relatedCard.id}`,
        "DECLARED_SUPPORT",
      );
    if (r.relationType === "DERIVED_FROM")
      add(`card:${r.relatedCard.id}`, `card:${r.currentCard.id}`, "PROVENANCE");
    if (
      ["SUPPORTS", "DERIVED_FROM"].includes(r.relationType) &&
      !s.activeRelations.some((a) => a.id === r.id)
    )
      inactiveEdges.add(edges[edges.length - 1]);
  }
  for (const a of s.actions) {
    titles.set(`action:${a.id}`, a.title);
    if (a.sourceCardId)
      add(`card:${a.sourceCardId}`, `action:${a.id}`, "ACTION_ORIGIN");
  }
  for (const r of s.requirements)
    add(
      `${r.targetKind}:${r.targetId}`,
      `action:${r.actionId}`,
      "REQUIREMENT",
      r.hard,
    );
  for (const d of s.deliverables) {
    titles.set(`deliverable:${d.id}`, d.title);
    for (const e of d.evidences.filter((e) => e.confirmed && e.cardId))
      add(`card:${e.cardId}`, `deliverable:${d.id}`, "ALTERNATIVE_EVIDENCE");
  }
  for (const a of s.artifacts) {
    titles.set(`artifact:${a.id}`, `${a.artifactType} 成果`);
    for (const b of blocks(a.missionReceipt?.blockMapJson ?? a.claims)) {
      const id = `artifact:${a.id}#${b.blockId ?? (b as { claimId?: string }).claimId ?? "unknown"}`;
      titles.set(id, `成果中的 ${b.blockId ?? "引用块"}`);
      for (const source of b.sourceIds ??
        (b.cardIds ?? []).map((id) => `card:${id}`))
        add(source, id, "BLOCK_CITATION");
    }
  }
  for (const m of s.missions) {
    titles.set(`mission:${m.id}`, m.goal);
    const reviewed =
      (m.planJson as { impactGuard?: string }).impactGuard === s.sharedHash;
    for (const step of m.steps.filter(
      (step) => step.planRevision === m.planRevision,
    )) {
      for (const src of (Array.isArray(step.readSetJson)
        ? step.readSetJson
        : []) as Array<{ id?: string }>)
        if (src.id && !reviewed)
          add(src.id, `mission:${m.id}`, "MISSION_READSET");
    }
    for (const o of m.outputs)
      for (const b of blocks(o.contentJson)) {
        const id = `output:${o.id}#${b.blockId}`;
        titles.set(id, `草稿 ${o.revision} / ${b.blockId}`);
        if (o.id !== m.outputs[0]?.id) historicalBlocks.add(id);
        for (const src of b.sourceIds ?? []) add(src, id, "BLOCK_CITATION");
        if (o.id === m.outputs[0]?.id && !reviewed)
          add(id, `mission:${m.id}`, "MISSION_OUTPUT");
      }
  }
  for (const edge of edges) {
    edge.fromTitle = titles.get(edge.from) ?? "缺失来源";
    edge.toTitle = titles.get(edge.to) ?? "待核对对象";
  }
  function state(id: string, seen = new Set<string>()): DependencyState {
    if (seen.has(id)) {
      cycle = true;
      return "UNKNOWN";
    }
    if (stateCache.has(id)) return stateCache.get(id)!;
    const next = new Set(seen).add(id);
    let value: DependencyState = "UNKNOWN";
    if (id.startsWith("card:"))
      value = cardState.get(id.slice(5)) === "CURRENT" ? "MET" : "UNKNOWN";
    if (id.startsWith("action:")) {
      const a = s.actions.find((a) => `action:${a.id}` === id);
      if (a) {
        const deps = s.requirements
          .filter((r) => r.actionId === a.id && r.hard)
          .map((r) => {
            const other = state(`${r.targetKind}:${r.targetId}`, next);
            if (r.targetKind === "action") {
              const previous = s.actions.find((a) => a.id === r.targetId);
              return !previous || previous.status === "CANCELLED"
                ? "UNKNOWN"
                : previous.status !== "DONE"
                  ? "UNMET"
                  : other;
            }
            return other;
          });
        value = deps.includes("UNMET")
          ? "UNMET"
          : deps.includes("UNKNOWN")
            ? "UNKNOWN"
            : "MET";
      }
    }
    if (id.startsWith("deliverable:")) {
      const d = s.deliverables.find((d) => `deliverable:${d.id}` === id);
      if (d) {
        let expected: string[] = [];
        try {
          expected = JSON.parse(d.expectedEvidence);
        } catch {
          expected = [];
        }
        const groups = expected.map((type) =>
          d.evidences
            .filter((e) => e.confirmed && e.evidenceType === type)
            .some(
              (e) => !!e.cardId && state(`card:${e.cardId}`, next) === "MET",
            ),
        );
        value = expected.length && groups.every(Boolean) ? "MET" : "UNKNOWN";
      }
    }
    stateCache.set(id, value);
    return value;
  }
  const roots = [...new Set(rootIds)].filter(
    (id) =>
      titles.has(id) ||
      edges.some((edge) => edge.from === id || edge.to === id),
  );
  const items: ImpactItem[] = [];
  const found = new Set<string>();
  let truncated = false;
  const queue = roots.map((id) => ({
    id,
    path: [] as ImpactEdge[],
    visited: new Set([id]),
  }));
  while (queue.length) {
    const q = queue.shift()!;
    if (q.path.length >= 8) {
      if (edges.some((e) => e.from === q.id)) truncated = true;
      continue;
    }
    for (const e of edges.filter((e) => e.from === q.id)) {
      if (q.visited.has(e.to)) continue;
      const path = [...q.path, e];
      const result = state(e.to);
      const m = s.missions.find((m) => `mission:${m.id}` === e.to),
        a = s.actions.find((a) => `action:${a.id}` === e.to);
      const historical =
        historicalBlocks.has(e.to) ||
        (!!m && ["SUCCEEDED", "CANCELLED"].includes(m.status)) ||
        (!!a && ["DONE", "CANCELLED"].includes(a.status));
      if (!found.has(e.to)) {
        items.push({
          target: e.to,
          title: titles.get(e.to) ?? e.to,
          kind: e.to.startsWith("mission:")
            ? "PLAN_STALE"
            : e.hard && result === "UNMET"
              ? "HARD_PREREQUISITE_UNMET"
              : e.kind === "DECLARED_SUPPORT"
                ? "SUPPORT_CHANGED"
                : "NEEDS_REVIEW",
          path,
          state: result,
          historical,
        });
        found.add(e.to);
        if (items.length >= 300) {
          truncated = true;
          queue.length = 0;
          break;
        }
        queue.push({ id: e.to, path, visited: new Set(q.visited).add(e.to) });
      }
    }
  }
  // Check the bounded graph even when no changed root exists; a cycle cannot certify its own evidence.
  const visited = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) {
      cycle = true;
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    active.add(id);
    for (const edge of edges.filter(
      (e) => e.from === id && !inactiveEdges.has(e),
    ))
      visit(edge.to);
    active.delete(id);
  }
  for (const edge of edges) visit(edge.from);
  for (const a of s.actions) state(`action:${a.id}`);
  const reasons = [
    ...s.coverage.reasons,
    ...(cycle ? ["DEPENDENCY_CYCLE"] : []),
    ...(truncated ? ["PATH_LIMIT"] : []),
  ];
  return {
    schemaVersion: 1 as const,
    projectId: s.project.id,
    rootIds: roots,
    observedAt: s.observedAt,
    manifestHash: s.hash,
    coverage: {
      ...s.coverage,
      state: reasons.length ? "INCOMPLETE" : "COMPLETE",
      reasons,
    },
    items,
    actionStates: s.actions.map((a) => ({
      id: a.id,
      title: a.title,
      state: state(`action:${a.id}`),
      estimatedMinutes: a.estimatedMinutes,
      status: a.status,
    })),
    note: "来源取代或支持变化只要求复核，不代表旧事实为假；历史成果及完成回执保留。",
  };
}
export type ImpactAssessment = ReturnType<typeof assessImpact>;

/** Include durable mutation roots after reversals; job status never changes semantic source hashes. */
export function changedRoots(s: DecisionSnapshot) {
  return [
    ...new Set([
      ...s.cardStates
        .filter((c) => ["SUPERSEDED", "CONTESTED"].includes(c.state))
        .map((c) => `card:${c.id}`),
      ...s.mutations
        .filter(
          (m) =>
            !m.mutationReceiptId.startsWith("capture:") &&
            !m.mutationReceiptId.startsWith("decision:"),
        )
        .flatMap((m) =>
          Array.isArray(m.rootsJson)
            ? m.rootsJson.filter((id): id is string => typeof id === "string")
            : [],
        ),
    ]),
  ];
}
