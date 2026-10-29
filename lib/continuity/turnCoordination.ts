import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { record, type Tx } from "@/lib/conversation/repository";
import type { ConversationTurn } from "@/lib/generated/prisma/client";
import type { ConversationActor } from "@/lib/types/conversation";
import type { DirectiveScope } from "@/lib/types/continuity";
import { effectiveContinuity, assertDirectiveEffect } from "./directiveService";

export type Coordination = { generation: number; state: "ACTIVE" | "INVALIDATED" | "DRAINING" | "RECOORDINATING" | "STOPPING" | "TERMINAL";
  scopes: DirectiveScope[]; bindings: Array<{ intentHash: string; reusePolicyHash: string; nextBoundary: string | null }>;
  generationHistory?: unknown[]; drainDeadline?: string; pendingEvents?: string[] };
export function coordination(turn: { readManifestJson: unknown }): Coordination | null {
  const c = record(record(turn.readManifestJson).coordination); return typeof c.generation === "number" ? c as Coordination : null;
}
export async function initialCoordination(userId: string, scopes: DirectiveScope[], tx: Tx = db): Promise<Coordination> {
  const views = await Promise.all(scopes.map(s => effectiveContinuity(userId, s, tx)));
  return { generation: 0, state: views.some(v => v.stopped) ? "STOPPING" : "ACTIVE", scopes,
    bindings: views.map(v => ({ intentHash: v.intentHash, reusePolicyHash: v.reusePolicyHash, nextBoundary: v.nextBoundary })) };
}
export async function assertTurnCurrent(turn: ConversationTurn, userId: string, generation: number | undefined, tx: Tx = db, effect?: "MODEL" | "EXTERNAL_READ") {
  const c = coordination(turn); if (!c) return;
  if (c.state === "STOPPING" || record(turn.readManifestJson).stopRequested) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
  if (generation !== c.generation || c.state !== "ACTIVE") throw new AppError("TURN_RECOORDINATE", "工作方向已变化，正在重新协调", 409);
  for (const [i, scope] of c.scopes.entries()) {
    if (!await tx.projectMembership.findUnique({ where: { userId_projectId: { userId, projectId: scope.projectId } } }))
      throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化，未继续派发或发布", 404);
    const v = await effectiveContinuity(userId, scope, tx);
    if (v.stopped) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    if (v.intentHash !== c.bindings[i]?.intentHash || v.reusePolicyHash !== c.bindings[i]?.reusePolicyHash)
      throw new AppError("TURN_RECOORDINATE", "工作方向、有效期或资料使用要求已变化，正在重新协调", 409);
    if (effect) assertDirectiveEffect(v, effect);
  }
}
/** Called with the existing executor lease. Only raw successful observations survive; model semantics never cross generations. */
export async function activateNextGeneration(actor: ConversationActor, turnId: string, token: string) {
  return db.$transaction(async tx => {
    await tx.user.updateMany({ where: { id: actor.userId }, data: { continuitySeq: { increment: 0 } } });
    await tx.conversationTurn.updateMany({ where: { id: turnId }, data: { callCount: { increment: 0 } } });
    const turn = await tx.conversationTurn.findUniqueOrThrow({ where: { id: turnId } }), c = coordination(turn);
    if (!c || turn.leaseToken !== token || !turn.leaseUntil || +turn.leaseUntil <= Date.now()) throw new AppError("TURN_LEASE_LOST", "执行权已变化", 409);
    if (c.state === "STOPPING" || record(turn.readManifestJson).stopRequested) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    const fresh = await initialCoordination(actor.userId, c.scopes, tx);
    if (fresh.state === "STOPPING") throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    const manifest = record(turn.readManifestJson), ops = record(manifest.operations);
    const pending = Object.values(ops).some(raw => ["RESERVED", "DISPATCH_COMMITTED", "DISPATCHING"].includes(String(record(raw).status)));
    const deadline = c.drainDeadline ?? new Date(Date.now() + 25000).toISOString();
    if (pending && Date.now() < Date.parse(deadline)) {
      await tx.conversationTurn.update({ where: { id: turnId }, data: { readManifestJson: json({ ...manifest, coordination: { ...c, state: "DRAINING", drainDeadline: deadline } }) } });
      return null;
    }
    for (const raw of Object.values(ops)) {
      const op = record(raw); if (["DISPATCH_COMMITTED", "DISPATCHING"].includes(String(op.status))) Object.assign(op, { status: "UNKNOWN", result: undefined, failure: "DRAIN_DEADLINE" });
      if (op.status === "RESERVED") Object.assign(op, { status: "FAILED", failure: "NOT_DISPATCHED" });
    }
    const history = [...(c.generationHistory ?? []), { generation: c.generation, outcome: "RECOORDINATED", at: new Date().toISOString(),
      bindingHash: jsonHash(c.bindings), sourceRefs: manifest.sourceRefs, callCount: turn.callCount }].slice(-32);
    if (c.generation >= 31) throw new AppError("INVESTIGATION_BUDGET_EXHAUSTED", "本轮调整次数已达到边界，请接续新一轮讨论", 409);
    const next: Coordination = { ...fresh, generation: c.generation + 1, state: "ACTIVE", generationHistory: history };
    const runs = await tx.agentRun.findMany({ where: { turnId, conversationId: turn.conversationId } });
    for (const run of runs) if (record(run.trace).r4Draft && !await tx.agentMessage.findFirst({ where: { runId: run.id } }))
      await tx.copilotToolExecution.updateMany({ where: { sourceRunId: run.id, status: "PENDING" }, data: { status: "DECLINED" } });
    const nextManifest = { ...manifest, operations: ops, coordination: next, experience: undefined, modelResults: {}, directiveCandidate: undefined, initialObservation: undefined,
      sourceRefs: [], presentationDraft: undefined, progressEvents: manifest.progressEvents };
    await tx.conversationTurn.update({ where: { id: turnId }, data: { readManifestJson: json(nextManifest) } });
    return next;
  });
}
