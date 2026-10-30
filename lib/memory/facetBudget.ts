export type FacetGroup = { items: unknown[]; readSet?: unknown[]; coverage: { complete: boolean } };
/** Hypotheses age out first, then synthesis. A trimmed hypothesis leaves its read set together with it. */
export function fitFacetGroups<G extends FacetGroup>(groups: G[], budget: number): { groups: G[]; omitted: number[] } {
  const fitted = groups.map(g => ({ ...g, items: [...g.items], ...(g.readSet ? { readSet: [...g.readSet] } : {}), coverage: { ...g.coverage } })) as G[];
  const size = () => JSON.stringify(fitted.map(g => g.items)).length;
  while (size() > budget) {
    const group = fitted.find(g => g.items.length);
    if (!group) break;
    group.items.pop(); group.readSet?.pop();
  }
  const omitted = fitted.map((g, index) => groups[index].items.length - g.items.length);
  fitted.forEach((g, index) => { if (omitted[index]) g.coverage = { ...g.coverage, complete: false }; });
  return { groups: fitted, omitted };
}
