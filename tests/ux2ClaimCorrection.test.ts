import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-correction"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { correctClaim } from "@/lib/memory/claimService";
import { claimControlState } from "@/lib/memory/claimEffective";
import { claimTextHash, validateClaimLocator } from "@/lib/memory/claimLocator";
import { effectiveContinuity } from "@/lib/continuity/directiveService";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "纠正测试", passwordHash: "fixture" } });
  const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
  const p = await db.project.create({ data: { title: "同一项目", description: "fixture", goal: "原目标", scenario: "RESEARCH", memberships: { create: { userId: u.id } } } });
  const c = await db.capture.create({ data: { projectId: p.id, rawText: "延迟52ms😀，尚未实测" } });
  const origin = { kind: "CAPTURE", id: c.id, contentHash: claimTextHash(c.rawText), offsetEncoding: "UTF16_CODE_UNITS", normalization: "RAW_V1", start: 0, end: c.rawText.length, quote: c.rawText };
  return { actor, p, c, origin, command: { requestId: crypto.randomUUID(), scope: { projectId: p.id }, origin, operation: "CORRECT", expectedSeq: 0, userQuote: "52ms只是我的报告，不是设备实测" } };
}
test("精确定位重复句与 emoji；拒绝跨代理对、伪造原文和旧 hash", () => {
  const text = "甲😀甲😀", base = { kind: "MESSAGE", id: "m", contentHash: claimTextHash(text), offsetEncoding: "UTF16_CODE_UNITS", normalization: "RAW_V1", start: 3, end: 6, quote: "甲😀" };
  expect(validateClaimLocator(text, base).start).toBe(3);
  expect(() => validateClaimLocator(text, { ...base, start: 2 })).toThrow();
  expect(() => validateClaimLocator(text, { ...base, quote: "不存在" })).toThrow();
  expect(() => validateClaimLocator(text + "新", base)).toThrow();
});
test("纠正改变 reuse hash，保持原目标、原文与 intent hash；同请求回放", async () => {
  const { actor, p, c, command } = await fixture(), before = await effectiveContinuity(actor.userId, command.scope);
  const result = await correctClaim(actor, command), after = await effectiveContinuity(actor.userId, command.scope);
  expect(after.intentHash).toBe(before.intentHash); expect(after.reusePolicyHash).not.toBe(before.reusePolicyHash);
  expect(after.seq).toBe(1); expect(await correctClaim(actor, command)).toEqual(result);
  expect((await db.capture.findUniqueOrThrow({ where: { id: c.id } })).rawText).toBe(c.rawText);
  expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).goal).toBe("原目标");
  expect((await claimControlState(actor.userId, command.scope)).corrections[0].userCorrection).toBe(command.userQuote);
});
test("撤回追加历史而不复活旧 hash；并发旧序号被拒绝", async () => {
  const { actor, command } = await fixture(), original = await effectiveContinuity(actor.userId, command.scope);
  await correctClaim(actor, command);
  await expect(correctClaim(actor, { ...command, requestId: crypto.randomUUID() })).rejects.toMatchObject({ code: "DIRECTIVE_CHANGED" });
  await correctClaim(actor, { ...command, requestId: crypto.randomUUID(), operation: "WITHDRAW", expectedSeq: 1, expectedRevision: 1 });
  expect((await claimControlState(actor.userId, command.scope)).corrections).toHaveLength(0);
  expect((await effectiveContinuity(actor.userId, command.scope)).reusePolicyHash).not.toBe(original.reusePolicyHash);
  expect(await db.agentClaimEvent.count({ where: { ownerUserId: actor.userId } })).toBe(2);
});
test("跨项目伪造原件和同请求异载荷被拒绝", async () => {
  const { actor, command } = await fixture(), other = await fixture();
  await expect(correctClaim(actor, { ...command, origin: other.origin })).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
  await correctClaim(actor, command);
  await expect(correctClaim(actor, { ...command, userQuote: "另外一句" })).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
});
