import { createHash } from "node:crypto";
import { AppError } from "@/lib/api";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import type { Tx } from "./repository";
import { readProjectMaterialView, type MaterialCoverage } from "./sourceSignals";

type Pointer = { id: string; hash: string };
export type MaterialUseFact = {
  kind: "SAVED" | "CANDIDATE" | "ASSOCIATED" | "BOUND" | "CONTEXT_POINTER" | "OUTPUT_REFERENCE" | "EXACT_QUOTE" | "ARTIFACT_ADOPTION";
  refId: string;
  revision?: number;
  artifactId?: string;
};
/** 当前可用性只覆盖“此刻能否作为当前依据”，不改写任何历史事实。 */
export type MaterialUseCurrentUse = {
  state: "ALLOWED" | "SUPPRESSED" | "UNKNOWN";
  independentEvidence: boolean;
  reason: string;
  policy: string;
  checkedAt: string;
  appliesTo: "CURRENT_USE_ONLY";
};
export type MaterialUseItem = {
  sourcePointer: Pointer;
  title: string;
  /** 仅表示版本匹配：CURRENT 表示当前材料 hash 与历史指针一致。 */
  availability: "CURRENT" | "CHANGED" | "UNAVAILABLE";
  /** availability 的冻结含义：版本匹配不等于当前允许使用，也不表示独立证据。 */
  availabilityMeaning: "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION";
  /** 原 SourcePolicy 的当前使用判定；null 只表示调用方未提供用户上下文，不能当作允许。 */
  currentUse: MaterialUseCurrentUse | null;
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

/**
 * 当前可用性沿原 SourcePolicy 判定：抑制/撤权/来源链未知只影响“当前能否作为依据”，
 * 历史 facts（绑定、引用、摘录、归入回执）保留原身份，永不因撤权删除。
 * SourcePolicy 抛错时保守记为 UNKNOWN，保留原因，不中断整份读回。
 */
async function currentUseOf(input: { userId: string; projectId: string; missionId: string; sourceId: string; tx: Tx; checkedAt: string }): Promise<MaterialUseCurrentUse> {
  try {
    const use = await sourceUse(input.userId, input.projectId, input.sourceId, input.tx, { missionId: input.missionId });
    return { state: use.state, independentEvidence: use.independentEvidence, reason: use.reason, policy: "SOURCE_POLICY_V1", checkedAt: input.checkedAt, appliesTo: "CURRENT_USE_ONLY" };
  } catch (error) {
    const reason = error instanceof AppError ? error.code : "SOURCE_POLICY_UNAVAILABLE";
    return { state: "UNKNOWN", independentEvidence: false, reason, policy: "SOURCE_POLICY_V1", checkedAt: input.checkedAt, appliesTo: "CURRENT_USE_ONLY" };
  }
}

/** A bounded read projection. No context rebuilding, provider, events or writes. */
export async function materialUseProjection(tx: Tx, input: { missionId: string; projectId: string; questionId: string | null; sourceId?: string; userId?: string }) {
  const checkedAt = new Date().toISOString();
  const [eventRows, stepRows, outputRows, receiptRows] = await Promise.all([
    tx.agentMissionEvent.findMany({ where: { missionId: input.missionId, type: { in: ["SOURCE_ARRIVED", "SOURCE_ASSOCIATED"] } }, orderBy: { seq: "desc" }, take: 81 }),
    tx.agentMissionStep.findMany({ where: { missionId: input.missionId, toolName: "bind_project_sources", status: "SUCCEEDED" }, orderBy: { ordinal: "desc" }, take: 41 }),
    tx.agentMissionOutput.findMany({ where: { missionId: input.missionId }, orderBy: { revision: "desc" }, take: 21 }),
    tx.missionArtifactReceipt.findMany({ where: { missionId: input.missionId, projectId: input.projectId }, orderBy: { createdAt: "desc" }, take: 21 }),
  ]);
  // FS-A06：AgentRun 没有 mission 列。先按原委托归属过滤再取窗口，同项目其他讨论不能挤掉本委托的回执；
  // 多取一条用于判定是否确有剩余。未找到只表示有界覆盖不足，不等于从未使用。
  const runLimit = 40;
  const runIds = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "AgentRun" WHERE "projectId"=${input.projectId} AND "runType"='CHAT'
      AND json_extract(trace, '$.missionId')=${input.missionId}
    ORDER BY "createdAt" DESC, id DESC LIMIT ${runLimit + 1}`;
  const runRows = runIds.length
    ? await tx.agentRun.findMany({ where: { id: { in: runIds.map(row => row.id) } }, select: { id: true, trace: true } })
    : [];
  // 还原 SQL 的 createdAt/id 倒序，并只保留前 40 条窗口内记录。
  const runs = runIds.slice(0, runLimit).flatMap(row => {
    const found = runRows.find(candidate => candidate.id === row.id);
    return found ? [found] : [];
  });
  const events = eventRows.slice(0, 80), steps = stepRows.slice(0, 40), outputs = outputRows.slice(0, 20), receipts = receiptRows.slice(0, 20);
  const items = new Map<string, MaterialUseItem>();
  let sourceLimitReached = false;
  const add = (p: Pointer, fact: MaterialUseFact) => {
    let item = items.get(key(p));
    if (!item) {
      if (items.size >= 8) { sourceLimitReached = true; return; }
      item = { sourcePointer: p, title: p.id.startsWith("attachment:") ? "项目附件" : "项目记录", availability: "UNAVAILABLE",
        availabilityMeaning: "REVISION_MATCH_ONLY_NOT_CURRENT_PERMISSION", currentUse: null,
        facts: [], coverage: null, bodyCoverage: "NOT_RECORDED", excerpt: null };
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
  for (const run of runs) {
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
    if (view) {
      item.title = view.title;
      item.coverage = view.coverage;
      item.availability = view.source.hash === item.sourcePointer.hash ? "CURRENT" : "CHANGED";
      if (item.availability === "CURRENT") item.excerpt ??= view.source.text.slice(0, 400);
      if (item.availability === "CURRENT" && !item.facts.some(f => f.kind === "SAVED")) item.facts.unshift({ kind: "SAVED", refId: item.sourcePointer.id });
    }
    // 历史 facts 与 availability 原样保留；当前许可单独判定，撤权不删除历史。
    item.currentUse = input.userId
      ? await currentUseOf({ userId: input.userId, projectId: input.projectId, missionId: input.missionId, sourceId: item.sourcePointer.id, tx, checkedAt })
      : null;
  }
  return {
    schemaVersion: 1 as const, questionId: input.questionId, items: [...items.values()],
    coverage: {
      eventLimit: 80, eventsInspected: events.length, eventsTruncated: eventRows.length > 80,
      stepLimit: 40, stepsInspected: steps.length, stepsTruncated: stepRows.length > 40,
      outputLimit: 20, outputsInspected: outputs.length, outputsTruncated: outputRows.length > 20,
      receiptsInspected: receipts.length, receiptsTruncated: receiptRows.length > 20,
      // 原 projectRunLimit 保留为兼容别名：窗口已改为先按 Mission 过滤再取 40 条。
      runLimit, projectRunLimit: runLimit, runsInspected: runs.length, runsTruncated: runIds.length > runLimit, runScope: "MISSION_FILTERED" as const,
      sourceLimit: 8, sourceLimitReached, mapping: "DIRECT_SOURCE_POINTERS_ONLY" as const,
    },
  };
}
export type MaterialUseProjection = Awaited<ReturnType<typeof materialUseProjection>>;
