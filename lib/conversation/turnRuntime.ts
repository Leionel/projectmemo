import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json, jsonHash } from "@/lib/mission/contracts";
import { lockConversation, ownedConversation, record } from "./repository";
import type { ConversationActor } from "@/lib/types/conversation";
import type { Prisma } from "@/lib/generated/prisma/client";

const execution = new AsyncLocalStorage<{ turnId: string; token: string }>();
export function turnElapsedMs(turn: { createdAt: Date; readManifestJson: unknown }) {
  const manifest = record(turn.readManifestJson);
  if (manifest.deferred === true) return Number(manifest.runtimeAccumulatedMs ?? manifest.runtimeActiveCheckpointMs ?? 0) +
    (typeof manifest.runtimeStartedAt === "string" ? Math.max(0, Date.now() - Date.parse(manifest.runtimeStartedAt)) : 0);
  return Date.now() - turn.createdAt.getTime();
}
export function assertTurnLease(turn: { id: string; leaseToken: string | null; leaseUntil: Date | null }) {
  const lease = execution.getStore();
  if (turn.leaseToken && (lease?.turnId !== turn.id || lease.token !== turn.leaseToken || !turn.leaseUntil || turn.leaseUntil.getTime() <= Date.now()))
    throw new AppError("TURN_LEASE_LOST", "原调查的执行权已变化，请读取当前状态", 409);
}
export async function mutateTurn(actor: ConversationActor, conversationId: string, turnId: string,
  apply: (manifest: Record<string, unknown>, tx: Prisma.TransactionClient) => Promise<Record<string, unknown>> | Record<string, unknown>) {
  return db.$transaction(async tx => {
    await lockConversation(tx, conversationId);
    const c = await ownedConversation(actor, conversationId, tx), turn = await tx.conversationTurn.findFirstOrThrow({ where: { id: turnId, conversationId } });
    assertTurnLease(turn);
    if (c.activeTurnId !== turnId || c.version !== turn.baseVersion + 1 || !["OBSERVING", "GENERATING"].includes(turn.status)) throw new AppError("TURN_CHANGED", "原调查已结束或上下文已变化", 409);
    const manifest = record(turn.readManifestJson);
    if (manifest.stopRequested) throw new AppError("TURN_STOP_REQUESTED", "已停止本轮调查", 409);
    const next = await apply(manifest, tx);
    await tx.conversationTurn.update({ where: { id: turnId }, data: { readManifestJson: json(next) } });
    return next;
  });
}
export type TurnOperation = { id: string; inputHash: string; kind: string; status: "DISPATCHING" | "SUCCEEDED" | "FAILED" | "UNKNOWN";
  startedAt: string; finishedAt?: string; result?: unknown; failure?: string; reservedMicrousd: number; billedMicrousd?: number | null };
export async function turnOperation<T>(actor: ConversationActor, conversationId: string, turnId: string, operationId: string,
  kind: string, input: unknown, run: () => Promise<T>, external = false): Promise<T> {
  const inputHash = jsonHash(input); let replay: TurnOperation | undefined;
  await mutateTurn(actor, conversationId, turnId, async (manifest, tx) => {
    const ops = { ...record(manifest.operations) };
    const old = ops[operationId] as TurnOperation | undefined;
    if (old) {
      if (old.inputHash !== inputHash || old.kind !== kind) throw new AppError("OPERATION_INPUT_CHANGED", "原步骤输入已变化，请重新开始调查", 409);
      replay = old; return manifest;
    }
    if (Object.keys(ops).length >= 32) throw new AppError("INVESTIGATION_BUDGET_EXHAUSTED", "本轮步骤达到预算边界", 409);
    if (external) {
      const entries = Object.values(ops) as TurnOperation[];
      if (entries.filter(o => o.reservedMicrousd > 0).length >= 4) throw new AppError("EXTERNAL_BUDGET_EXHAUSTED", "本轮联网额度已用完，可以依据现有资料回答", 409);
      const account = await tx.accountSecurity.findUnique({ where: { userId: actor.userId } });
      if (account) {
        if (!account.emailVerifiedAt || account.dailyCloudLimit <= 0) throw new AppError("CLOUD_ACCESS_DISABLED", "当前账号未开通云端额度", 403);
        const day = new Date().toISOString().slice(0, 10);
        await tx.accountCloudUsage.upsert({ where: { userId_day: { userId: actor.userId, day } }, create: { userId: actor.userId, day, used: 0 }, update: {} });
        if (!(await tx.accountCloudUsage.updateMany({ where: { userId: actor.userId, day, used: { lt: account.dailyCloudLimit } }, data: { used: { increment: 1 } } })).count)
          throw new AppError("CLOUD_QUOTA_EXHAUSTED", "今日云端调用额度已用完", 429);
      }
    }
    ops[operationId] = { id: operationId, inputHash, kind, status: "DISPATCHING", startedAt: new Date().toISOString(), reservedMicrousd: external ? 750 : 0 } satisfies TurnOperation;
    return { ...manifest, operations: ops };
  });
  if (replay) {
    if (replay.status === "SUCCEEDED") return replay.result as T;
    if (replay.reservedMicrousd > 0 || replay.status === "FAILED")
      throw new AppError(replay.status === "FAILED" ? "OPERATION_FAILED" : "EXTERNAL_RESULT_UNKNOWN", replay.failure ?? "原步骤可能已经发出，不能自动重发；请读取已有结果后决定是否重新调查", 409);
  }
  try {
    const result = await run();
    if (JSON.stringify(result).length > 96000) throw new AppError("TOOL_OUTPUT_LIMIT", "联网资料超过本轮读取范围", 422);
    await mutateTurn(actor, conversationId, turnId, manifest => ({ ...manifest, operations: { ...record(manifest.operations), [operationId]: {
      ...(record(manifest.operations)[operationId] as TurnOperation), status: "SUCCEEDED", finishedAt: new Date().toISOString(), result,
      billedMicrousd: external ? ((Array.isArray(result) && !result.length) ? 0 : 750) : 0,
    } } }));
    return result;
  } catch (error) {
    const known = error instanceof AppError && !["TURN_LEASE_LOST", "TURN_CHANGED", "TURN_STOP_REQUESTED"].includes(error.code);
    await mutateTurn(actor, conversationId, turnId, manifest => ({ ...manifest, operations: { ...record(manifest.operations), [operationId]: {
      ...(record(manifest.operations)[operationId] as TurnOperation), status: known ? "FAILED" : "UNKNOWN", finishedAt: new Date().toISOString(),
      failure: error instanceof AppError ? error.message : "外部请求结果未知，保留额度预占", billedMicrousd: null,
    } } })).catch(() => undefined);
    if (!known && external) throw new AppError("EXTERNAL_RESULT_UNKNOWN", "外部请求结果未知，保留额度预占；不会自动重发", 409);
    throw error;
  }
}
export async function withTurnLease<T>(turnId: string, token: string, run: () => Promise<T>): Promise<T> {
  return execution.run({ turnId, token }, run);
}
export const newTurnLease = () => randomUUID();
