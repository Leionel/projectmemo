import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import type { Tx } from "./repository";
import { readProjectMaterialView, type MaterialCoverage } from "./sourceSignals";

type Pointer = { id: string; hash: string };
export type MaterialUseFact = {
  kind: "SAVED" | "CANDIDATE" | "ASSOCIATED" | "BOUND" | "CONTEXT_POINTER" | "OUTPUT_REFERENCE" | "EXACT_QUOTE" | "ARTIFACT_ADOPTION";
  refId: string;
  revision?: number;
  artifactId?: string;
};
export type MaterialUseItem = {
  sourcePointer: Pointer;
  title: string;
  availability: "CURRENT" | "CHANGED" | "UNAVAILABLE";
  facts: MaterialUseFact[];
  coverage: MaterialCoverage | null;
  bodyCoverage: "NOT_RECORDED";
  excerpt: string | null;
};
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
function pointer(v: unknown): Pointer | null {
  const p = record(v);
  return typeof p.id === "string" && /^(capture|attachment):.+/.test(p.id) && typeof p.hash === "string" && /^[a-f0-9]{64}$/.test(p.hash) ? { id: p.id, hash: p.hash } : null;
}
const key = (p: Pointer) => `${p.id}@${p.hash}`;
const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

/** A bounded read projection. No context rebuilding, provider, events or writes. */
export async function materialUseProjection(tx: Tx, input: { missionId: string; projectId: string; questionId: string | null; sourceId?: string }) {
  const [eventRows, stepRows, outputRows, receiptRows, runRows] = await Promise.all([
    tx.agentMissionEvent.findMany({ where: { missionId: input.missionId, type: { in: ["SOURCE_ARRIVED", "SOURCE_ASSOCIATED"] } }, orderBy: { seq: "desc" }, take: 81 }),
    tx.agentMissionStep.findMany({ where: { missionId: input.missionId, toolName: "bind_project_sources", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" }, take: 41 }),
    tx.agentMissionOutput.findMany({ where: { missionId: input.missionId }, orderBy: { revision: "desc" }, take: 21 }),
    tx.missionArtifactReceipt.findMany({ where: { missionId: input.missionId, projectId: input.projectId }, orderBy: { createdAt: "desc" }, take: 21 }),
    // AgentRun has no mission column. Inspect a bounded project window; never return other tasks' traces.
    tx.agentRun.findMany({ where: { projectId: input.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 41, select: { id: true, trace: true } }),
  ]);
  const events = eventRows.slice(0, 80), steps = stepRows.slice(0, 40), outputs = outputRows.slice(0, 20), receipts = receiptRows.slice(0, 20);
  const items = new Map<string, MaterialUseItem>();
  let sourceLimitReached = false;
  const add = (p: Pointer, fact: MaterialUseFact) => {
    let item = items.get(key(p));
    if (!item) {
      if (items.size >= 8) { sourceLimitReached = true; return; }
      item = { sourcePointer: p, title: p.id.startsWith("attachment:") ? "项目附件" : "项目记录", availability: "UNAVAILABLE", facts: [], coverage: null, bodyCoverage: "NOT_RECORDED", excerpt: null };
      items.set(key(p), item);
    }
    if (!item.facts.some(f => f.kind === fact.kind && f.refId === fact.refId)) item.facts.push(fact);
  };
  if (input.sourceId) {
    const view = await readProjectMaterialView(input.projectId, input.sourceId, tx);
    if (!view) throw new AppError("SOURCE_NOT_FOUND", "资料不存在或不可访问", 404);
    add(view.source, { kind: "SAVED", refId: input.sourceId });
  }
  for (const e of events) {
    const payload = record(e.payloadJson);
    if (payload.questionId !== input.questionId) continue;
    const pointers = e.type === "SOURCE_ARRIVED" ? [payload.sourcePointer] : array(payload.pointers);
    for (const value of pointers) {
      const p = pointer(value);
      if (p) add(p, { kind: e.type === "SOURCE_ARRIVED" ? "CANDIDATE" : "ASSOCIATED", refId: e.id });
    }
  }
  const boundSteps = steps.filter(s => record(record(s.resultJson).data).questionId === input.questionId);
  for (const step of boundSteps) {
    for (const value of array(record(step.resultJson).sources)) {
      const p = pointer(value);
      if (p) {
        add(p, { kind: "BOUND", refId: step.id });
        const item = items.get(key(p)), text = record(value).text;
        if (item && typeof text === "string" && !item.excerpt) item.excerpt = text.slice(0, 400);
      }
    }
  }
  for (const run of runRows.slice(0, 40)) {
    const trace = record(run.trace);
    if (trace.missionId !== input.missionId) continue;
    const manifest = record(trace.contextManifest), included = array(manifest.includedStepIds);
    for (const value of array(manifest.sourcePointers)) {
      const p = pointer(value);
      if (!p || !items.has(key(p))) continue;
      const hasIncludedBinding = boundSteps.some(s => included.includes(s.id) && array(record(s.resultJson).sources).some(v => {
        const bound = pointer(v); return bound && key(bound) === key(p);
      }));
      if (hasIncludedBinding) add(p, { kind: "CONTEXT_POINTER", refId: run.id });
    }
  }
  for (const output of outputs) {
    const sources = array(output.sourceRefsJson);
    for (const block of array(record(output.contentJson).blocks)) {
      const b = record(block);
      for (const value of sources) {
        const p = pointer(value);
        if (!p || !items.has(key(p)) || !array(b.sourceIds).includes(p.id)) continue;
        add(p, { kind: "OUTPUT_REFERENCE", refId: output.id, revision: output.revision });
        const source = record(value);
        if (typeof source.text === "string" && array(b.citations).some(v => {
          const c = record(v), start = c.start, end = c.end;
          return c.sourceId === p.id && typeof start === "number" && typeof end === "number" && Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= (source.text as string).length && textHash((source.text as string).slice(start, end)) === c.excerptHash;
        })) add(p, { kind: "EXACT_QUOTE", refId: output.id, revision: output.revision });
        for (const receipt of receipts.filter(r => r.outputId === output.id && r.outputRevision === output.revision)) add(p, { kind: "ARTIFACT_ADOPTION", refId: receipt.id, revision: receipt.outputRevision, artifactId: receipt.artifactId });
      }
    }
  }
  for (const item of items.values()) {
    const view = await readProjectMaterialView(input.projectId, item.sourcePointer.id, tx);
    if (!view) continue;
    item.title = view.title;
    item.coverage = view.coverage;
    item.availability = view.source.hash === item.sourcePointer.hash ? "CURRENT" : "CHANGED";
    if (item.availability === "CURRENT") item.excerpt ??= view.source.text.slice(0, 400);
    if (item.availability === "CURRENT" && !item.facts.some(f => f.kind === "SAVED")) item.facts.unshift({ kind: "SAVED", refId: item.sourcePointer.id });
  }
  return {
    schemaVersion: 1 as const, questionId: input.questionId, items: [...items.values()],
    coverage: { eventLimit: 80, eventsTruncated: eventRows.length > 80, stepLimit: 40, stepsTruncated: stepRows.length > 40, outputLimit: 20, outputsTruncated: outputRows.length > 20, receiptsTruncated: receiptRows.length > 20, projectRunLimit: 40, runsTruncated: runRows.length > 40, sourceLimit: 8, sourceLimitReached, mapping: "DIRECT_SOURCE_POINTERS_ONLY" as const },
  };
}
export type MaterialUseProjection = Awaited<ReturnType<typeof materialUseProjection>>;
