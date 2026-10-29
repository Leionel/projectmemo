import { afterAll, afterEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("runtime"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { newTurnLease, withTurnLease, withTurnGeneration, turnOperation, mutateTurn, assertTurnLease } from "@/lib/conversation/turnRuntime";
import { activateNextGeneration } from "@/lib/continuity/turnCoordination";
import { submitDirective } from "@/lib/continuity/directiveService";
import { settleWorkspaceCloudCall } from "@/lib/auth/cloudQuota";
afterEach(() => vi.useRealTimers());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "运行边界合成用户", passwordHash: "unused" } });
  const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
  const p = await db.project.create({ data: { title: "测试项目", description: "synthetic", goal: "保留原目标", scenario: "RESEARCH", memberships: { create: { userId: u.id } } } });
  const c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: p.id });
  const turn = await submitConversationTurn(actor, c.id, { requestId: "ask", expectedVersion: 1, projectId: p.id, message: "调查当前状态" }, undefined, { defer: true });
  const token = newTurnLease(); await db.conversationTurn.update({ where: { id: turn.turnId }, data: { leaseToken: token, leaseUntil: new Date(Date.now() + 30000) } });
  return { actor, p, c, turnId: turn.turnId, token };
}
test("UNKNOWN canonical target cannot be resent through generation, alias or scope revision", async () => {
  const f = await fixture(); let dispatches = 0;
  await withTurnLease(f.turnId, f.token, async () => {
    await withTurnGeneration(0, async () => {
      await expect(turnOperation(f.actor, f.c.id, f.turnId, "first", "WEB_FETCH", { url: "https://example.com/a", sourceId: "old", scopeRevision: 1 }, async () => { dispatches++; throw new TypeError("unknown transport"); }, true)).rejects.toMatchObject({ code: "EXTERNAL_RESULT_UNKNOWN" });
    });
    await submitDirective(f.actor, f.c.id, { commandId: "revise", expectedSeq: 0, scope: { projectId: f.p.id }, operation: "SET", quote: "今天先核对日志" });
    expect((await activateNextGeneration(f.actor, f.turnId, f.token))?.generation).toBe(1);
    await withTurnGeneration(1, async () => {
      await expect(turnOperation(f.actor, f.c.id, f.turnId, "renamed", "WEB_FETCH", { url: "https://example.com/a", sourceId: "alias", scopeRevision: 2 }, async () => { dispatches++; return "unexpected"; }, true)).rejects.toMatchObject({ code: "EXTERNAL_RESULT_UNKNOWN" });
    });
  });
  expect(dispatches).toBe(1);
  const manifest = (await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson as { operations: Record<string, { status: string; reservedMicrousd: number }> };
  expect(Object.values(manifest.operations).reduce((sum, o) => sum + o.reservedMicrousd, 0)).toBe(750);
});
test("known raw observation reuses original observation time, with one external charge", async () => {
  const f = await fixture(); let dispatches = 0;
  await withTurnLease(f.turnId, f.token, async () => {
    const run = () => { dispatches++; return Promise.resolve({ title: "原始页面", content: "原文" }); };
    const input = { url: "https://example.com/b", sourceId: "original", scopeRevision: 1 };
    await withTurnGeneration(0, () => turnOperation(f.actor, f.c.id, f.turnId, "read", "WEB_FETCH", input, run, true));
    await submitDirective(f.actor, f.c.id, { commandId: "revise", expectedSeq: 0, scope: { projectId: f.p.id }, operation: "SET", quote: "今天先核对日志" });
    await activateNextGeneration(f.actor, f.turnId, f.token);
    const reused = await withTurnGeneration(1, () => turnOperation(f.actor, f.c.id, f.turnId, "next-read", "WEB_FETCH", { ...input, sourceId: "alias" }, run, true));
    expect(reused.content).toBe("原文");
  });
  expect(dispatches).toBe(1);
  const m = (await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } })).readManifestJson as { operations: Record<string, { observedAt?: string; finishedAt: string; reservedMicrousd: number }> };
  expect(m.operations["g1:next-read"].observedAt).toBe(m.operations["g0:read"].finishedAt);
  expect(Object.values(m.operations).reduce((sum, o) => sum + o.reservedMicrousd, 0)).toBe(750);
});
test("null or replaced lease cannot settle old billing; time boundary invalidates without a new event", async () => {
  const f = await fixture();
  await db.conversationTurn.update({ where: { id: f.turnId }, data: { reservationJson: [{ purpose: "ROUTE", callId: "g0:route", state: "RESERVED", inputTokens: 100, outputTokens: 100, inputAccounting: "UTF8_UPPER_BOUND" }] } });
  await withTurnLease(f.turnId, f.token, async () => {
    await db.conversationTurn.update({ where: { id: f.turnId }, data: { leaseToken: null } });
    expect(() => assertTurnLease({ id: f.turnId, leaseToken: null, leaseUntil: new Date(), readManifestJson: { coordination: { generation: 0 } } })).toThrow();
    await expect(settleWorkspaceCloudCall({ ...f.actor, turnId: f.turnId, purpose: "ROUTE", callId: "g0:route" }, { data: "", status: "SUCCESS", provider: "stub", durationMs: 1, usage: { inputTokens: 1, outputTokens: 1 } })).rejects.toMatchObject({ code: "TURN_LEASE_LOST" });
  });
  const expires = new Date(Date.now() + 1000).toISOString();
  await submitDirective(f.actor, f.c.id, { commandId: "short", expectedSeq: 0, scope: { projectId: f.p.id }, operation: "SET", quote: "今天先核对日志", validUntil: expires });
  await db.conversationTurn.update({ where: { id: f.turnId }, data: { leaseToken: f.token, leaseUntil: new Date(Date.now() + 30000) } });
  await activateNextGeneration(f.actor, f.turnId, f.token);
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(Date.parse(expires) + 1));
  await withTurnLease(f.turnId, f.token, () => withTurnGeneration(1, async () => {
    await expect(mutateTurn(f.actor, f.c.id, f.turnId, m => m)).rejects.toMatchObject({ code: "TURN_RECOORDINATE" });
  }));
  expect(await db.agentDirectiveEvent.count({ where: { ownerUserId: f.actor.userId } })).toBe(1);
  expect((await activateNextGeneration(f.actor, f.turnId, f.token))?.generation).toBe(2);
});
