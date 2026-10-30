import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-claim-rights"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { correctClaim, readClaimCorrections, resolveClaimText } from "@/lib/memory/claimService";
import { claimTextHash } from "@/lib/memory/claimLocator";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

async function user() {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "权限测试", passwordHash: "fixture" } });
  return { userId: u.id, sessionId: (await createSession(u.id)).session.id };
}
async function project(userId: string, title: string, role = "OWNER") {
  return db.project.create({ data: { title, description: "fixture", goal: "原目标", scenario: "RESEARCH", memberships: { create: { userId, role } } } });
}
async function conversation(ownerUserId: string, homeProjectId: string, linked: string[]) {
  return db.conversation.create({ data: { ownerUserId, createRequestId: crypto.randomUUID(), createInputHash: "hash", scope: "GLOBAL", homeProjectId,
    projects: { create: linked.map(id => ({ projectId: id })) } } });
}
const hashes = (text: string) => ({ kind: "MESSAGE" as const, contentHash: claimTextHash(text), offsetEncoding: "UTF16_CODE_UNITS" as const, normalization: "RAW_V1" as const,
  start: 0, end: text.length, quote: text });

test("项目只通过模型观察到的项目提到时不再放行跨项目消息原文", async () => {
  const actor = await user(), home = await project(actor.userId, "原项目"), mentioned = await project(actor.userId, "被提到项目");
  const c = await conversation(actor.userId, home.id, [home.id]);
  const text = "这条讨论顺带提到另一个项目", message = await db.agentMessage.create({ data: { conversationId: c.id, ownerUserId: actor.userId, role: "ASSISTANT",
    content: text, citations: [], proposedActions: [], blocksJson: { observedProjectIds: [home.id, mentioned.id] } } });
  await expect(resolveClaimText(actor, home.id, "MESSAGE", message.id)).resolves.toMatchObject({ text });
  await expect(resolveClaimText(actor, mentioned.id, "MESSAGE", message.id)).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
});

test("失去会话归属项目权限后，即使原项目仍可访问也读不到跨项目消息", async () => {
  const actor = await user(), a = await project(actor.userId, "A"), b = await project(actor.userId, "B");
  const c = await conversation(actor.userId, b.id, [b.id, a.id]);
  const text = "跨项目原话", message = await db.agentMessage.create({ data: { conversationId: c.id, ownerUserId: actor.userId, role: "USER", content: text, citations: [], proposedActions: [] } });
  const view = await resolveClaimText(actor, a.id, "MESSAGE", message.id);
  expect(view.text).toBe(text);
  await db.projectMembership.delete({ where: { userId_projectId: { userId: actor.userId, projectId: b.id } } });
  await expect(resolveClaimText(actor, a.id, "MESSAGE", message.id)).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
});

test("消息涉及的任一项目失权后与讨论读取一致地屏蔽原文", async () => {
  const actor = await user(), a = await project(actor.userId, "A"), b = await project(actor.userId, "B");
  const c = await conversation(actor.userId, a.id, [a.id, b.id]);
  const text = "同时涉及两个项目的原话", message = await db.agentMessage.create({ data: { conversationId: c.id, projectId: a.id, ownerUserId: actor.userId, role: "ASSISTANT",
    content: text, citations: [], proposedActions: [], blocksJson: { observedProjectIds: [a.id, b.id] } } });
  expect((await resolveClaimText(actor, a.id, "MESSAGE", message.id)).text).toBe(text);
  await db.projectMembership.delete({ where: { userId_projectId: { userId: actor.userId, projectId: b.id } } });
  await expect(resolveClaimText(actor, a.id, "MESSAGE", message.id)).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
});

test("OWNER 降级后不能再读取原委托产物", async () => {
  const actor = await user(), p = await project(actor.userId, "委托项目");
  const mission = await db.agentMission.create({ data: { projectId: p.id, ownerUserId: actor.userId, createRequestId: crypto.randomUUID(), createPayloadHash: "hash",
    goal: "核对指标", successCriteriaJson: {}, constraintsJson: {}, budgetJson: {}, budgetUsedJson: {}, status: "RUNNING" } });
  const output = await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "ANSWER", contentJson: { text: "原产物内容" }, sourceRefsJson: [], claimChecksJson: [], verificationStatus: "NEEDS_REVIEW" } });
  await expect(resolveClaimText(actor, p.id, "MISSION_OUTPUT", output.id)).resolves.toMatchObject({ text: expect.stringContaining("原产物内容") });
  await db.projectMembership.update({ where: { userId_projectId: { userId: actor.userId, projectId: p.id } }, data: { role: "MEMBER" } });
  await expect(resolveClaimText(actor, p.id, "MISSION_OUTPUT", output.id)).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
});

test("依赖来源不可读的推测不返回原文，仍可撤回原纠正", async () => {
  const actor = await user(), a = await project(actor.userId, "推测项目"), b = await project(actor.userId, "依赖项目");
  const c = await conversation(actor.userId, a.id, [a.id, b.id]);
  const text = "会议里说延迟只有 52ms", message = await db.agentMessage.create({ data: { conversationId: c.id, ownerUserId: actor.userId, role: "ASSISTANT",
    content: text, citations: [], proposedActions: [], blocksJson: { observedProjectIds: [a.id, b.id] } } });
  const claim = await db.agentClaim.create({ data: { ownerUserId: actor.userId, projectId: a.id, scopeKey: "{}", conversationId: c.id, originKey: "root", kind: "HYPOTHESIS",
    canonicalStatement: "延迟可能已经达标", conditionsJson: ["同一设备"], originJson: { kind: "MESSAGE", id: message.id, conversationId: c.id, allowedProjectIds: [a.id, b.id],
      sourceRevisionReadSet: [{ projectId: a.id, revision: 0, role: "OWNER" }] } } });
  await db.agentClaimEvent.create({ data: { claimId: claim.id, ownerUserId: actor.userId, revision: 1, requestId: "model:hypothesis", payloadHash: "hash",
    eventKind: "MODEL_PROPOSED", actorKind: "MODEL", targetHash: "hash", evidenceManifestJson: [], validFrom: new Date(Date.now() - 1000), validUntil: new Date(Date.now() + 86400000),
    assessmentJson: { root: { kind: "MESSAGE", id: message.id, conversationId: c.id, allowedProjectIds: [a.id, b.id],
      sourceRevisionReadSet: [{ projectId: a.id, revision: 0, role: "OWNER" }] }, scope: { projectId: a.id, conversationId: c.id }, statement: "延迟可能已经达标",
      effectiveState: "PROPOSED" } } });
  const origin = { ...hashes(claim.canonicalStatement), kind: "CLAIM" as const, id: claim.id };
  const command = { requestId: crypto.randomUUID(), scope: { projectId: a.id }, expectedSeq: 0, origin, operation: "CORRECT" as const, userQuote: "这里的达标只指启动时间" };
  await correctClaim(actor, command);
  await expect(resolveClaimText(actor, a.id, "CLAIM", claim.id)).resolves.toMatchObject({ text: claim.canonicalStatement });
  expect((await readClaimCorrections(actor, a.id)).corrections).toHaveLength(1);
  await db.projectMembership.delete({ where: { userId_projectId: { userId: actor.userId, projectId: b.id } } });
  await expect(resolveClaimText(actor, a.id, "CLAIM", claim.id)).rejects.toMatchObject({ code: "CLAIM_SOURCE_NOT_FOUND" });
  const controls = await readClaimCorrections(actor, a.id);
  expect(controls.corrections).toHaveLength(0);
  expect(controls.heads).toHaveLength(1);
  await correctClaim(actor, { ...command, requestId: crypto.randomUUID(), operation: "WITHDRAW", expectedSeq: 1, expectedRevision: 1 });
  expect((await readClaimCorrections(actor, a.id)).heads[0].eventKind).toBe("WITHDRAW_CORRECTION");
});
