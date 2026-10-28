import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("intent"));
import fs from "node:fs";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { admitDirective, candidateHash } from "@/lib/continuity/admission";
import { effectiveContinuity, submitDirective } from "@/lib/continuity/directiveService";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import type { DirectiveCommand } from "@/lib/types/continuity";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { createMission } from "@/lib/mission/missionService";
import { discoverMaterialPointers } from "@/lib/conversation/toolAdapter";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
async function fixture() {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成用户", passwordHash: "unused" } });
  const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
  const project = async () => db.project.create({ data: { title: "合成项目", description: "synthetic", goal: "原正式目标", scenario: "RESEARCH", memberships: { create: { userId: u.id } } } });
  const a = await project(), b = await project(), c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: a.id });
  return { actor, a, b, c };
}
function command(projectId: string, quote = "本周先稳演示，先别加功能"): DirectiveCommand {
  return { commandId: crypto.randomUUID(), expectedSeq: 0, scope: { projectId }, operation: "SET", quote, timezone: "Asia/Shanghai", admission: "LITERAL" };
}
test("literal admission separates authentication, quotation and interpretation; exact confirmation is bound", () => {
  const base = command("p");
  expect(admitDirective(base, new Date("2026-10-28T12:00:00Z"))).toMatchObject({ status: "DIRECT_APPLIED", until: "2026-11-01T16:00:00.000Z" });
  for (const quote of ["他说本周先稳演示", "不是本周先稳演示", "如果本周先稳演示", "永久改成演示目标", "本周先授权自动部署", "接下来先稳演示"]) expect(admitDirective({ ...base, quote }).status).not.toBe("DIRECT_APPLIED");
  const confirmed = { ...base, admission: "CONFIRMED" as const, kind: "WORKING_OBJECTIVE" as const, confirmed: true as const, validUntil: "2026-11-02T00:00:00Z" };
  expect(admitDirective({ ...confirmed, candidateHash: candidateHash(confirmed) }).status).toBe("CONFIRMED_APPLIED");
  expect(admitDirective({ ...confirmed, candidateHash: candidateHash(confirmed), quote: "另一项工作" }).status).toBe("REJECTED");
  expect(admitDirective({ ...confirmed, candidateHash: candidateHash(confirmed), expectedSeq: 1 }).status).toBe("REJECTED");
  expect(admitDirective({ ...base, timezone: "America/New_York" }, new Date("2026-10-28T12:00:00Z")).until).toBe("2026-11-02T05:00:00.000Z");
});
test("a new constraint does not replace the working objective; atomic project transfer copies no source grant", async () => {
  const { actor, a, b, c } = await fixture();
  const first = await submitDirective(actor, c.id, command(a.id));
  const second = await submitDirective(actor, c.id, { ...command(a.id, "今天先不要联网"), expectedSeq: 1 });
  expect(second.view.workingObjective).toBe(first.view.workingObjective);
  expect(second.view.constraints.some(s => s.includes("不要联网"))).toBe(true);
  const transfer: DirectiveCommand = { ...command(a.id), commandId: "transfer", expectedSeq: 2, operation: "TRANSFER", directiveId: first.view.directives[0].directiveId,
    targetProjectId: b.id, admission: "CONFIRMED", confirmed: true };
  const moved = await submitDirective(actor, c.id, { ...transfer, candidateHash: candidateHash(transfer) });
  expect(moved.events).toHaveLength(2);
  expect((await effectiveContinuity(actor.userId, { projectId: a.id })).workingObjective).toBeNull();
  const destination = await effectiveContinuity(actor.userId, { projectId: b.id });
  expect(destination.workingObjective).toBe(first.view.workingObjective);
  expect(destination.directives[0].validUntil).toBe(first.view.directives[0].validUntil);
  expect(destination.directives[0].sourceIds).toEqual([]);
});
test("one clarification consumes no model calls; Mission stop does not stop a different project task; flag-off retains active guards", async () => {
  const f = await fixture();
  const clarify = await submitConversationTurn(f.actor, f.c.id, { requestId: "clarify", expectedVersion: 1, message: "接下来先稳演示", llmContextApproved: true });
  expect(clarify.status).toBe("NEEDS_CLARIFICATION");
  expect(clarify.conversation.messages.filter(m => m.role === "ASSISTANT")).toHaveLength(1);
  expect((await db.conversationTurn.findUniqueOrThrow({ where: { id: clarify.turnId } })).callCount).toBe(0);
  const m = await createMission(f.actor.userId, { requestId: "m", projectId: f.a.id, goal: "核对记录", llmContextApproved: true });
  await submitDirective(f.actor, f.c.id, { ...command(f.a.id, "暂停任务"), scope: { projectId: f.a.id, missionId: m.id } });
  const unrelated = await createConversation(f.actor, { requestId: "unrelated", scope: "PROJECT", projectId: f.a.id });
  const answer = await submitConversationTurn(f.actor, unrelated.id, { requestId: "ask", expectedVersion: 1, message: "查看项目状态" });
  expect(answer.status).toBe("ANSWERED");
  const focused = await createConversation(f.actor, { requestId: "focused", scope: "PROJECT", projectId: f.a.id });
  const stopped = await submitConversationTurn(f.actor, focused.id, { requestId: "ask", expectedVersion: 1, message: "查看原委托", entityRef: { kind: "MISSION", id: m.id, projectId: f.a.id } });
  expect(stopped.status).toBe("CANCELLED");
  await submitDirective(f.actor, f.c.id, { ...command(f.a.id, "暂停任务"), expectedSeq: 1 });
  process.env.FOCUS_CONTINUITY_ENABLED = "false";
  try {
    const guarded = await createConversation(f.actor, { requestId: "guarded", scope: "PROJECT", projectId: f.a.id });
    expect((await submitConversationTurn(f.actor, guarded.id, { requestId: "ask", expectedVersion: 1, message: "查看项目状态" })).status).toBe("CANCELLED");
  } finally { process.env.FOCUS_CONTINUITY_ENABLED = "true"; }
});
test("parallel service requests serialize sequence CAS; exact replay and project isolation", async () => {
  const { actor, a, b, c } = await fixture();
  const beforeB = await effectiveContinuity(actor.userId, { projectId: b.id });
  const input = command(a.id);
  const raced = await Promise.allSettled([submitDirective(actor, c.id, input), submitDirective(actor, c.id, { ...input, commandId: crypto.randomUUID(), quote: "今天先核对启动日志" })]);
  expect(raced.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.agentDirectiveEvent.count({ where: { ownerUserId: actor.userId } })).toBe(1);
  const winner = raced.find(r => r.status === "fulfilled") as PromiseFulfilledResult<Awaited<ReturnType<typeof submitDirective>>>;
  const row = await db.agentDirectiveEvent.findUniqueOrThrow({ where: { id: winner.value.events[0] } });
  if (row.commandId === input.commandId) expect((await submitDirective(actor, c.id, input)).events).toEqual(winner.value.events);
  expect((await effectiveContinuity(actor.userId, { projectId: b.id })).intentHash).toBe(beforeB.intentHash);
  expect((await db.project.findUniqueOrThrow({ where: { id: a.id } })).goal).toBe("原正式目标");
  const connection = new Database(isolated.file); expect(connection.pragma("foreign_key_check")).toEqual([]); connection.close();
});
test("withdrawal does not revive superseded events; time crossing changes hash without new event", async () => {
  const { actor, a, c } = await fixture();
  const input = { ...command(a.id, "今天先稳演示"), validUntil: new Date(Date.now() + 60000).toISOString() };
  const first = await submitDirective(actor, c.id, input), event = first.view.directives[0];
  const afterTime = await effectiveContinuity(actor.userId, input.scope, db, new Date(Date.now() + 61000));
  expect(afterTime.directives).toHaveLength(0); expect(afterTime.intentHash).not.toBe(first.view.intentHash); expect(afterTime.seq).toBe(first.view.seq);
  const replaced = await submitDirective(actor, c.id, { ...input, commandId: "replace", expectedSeq: 1, directiveId: event.directiveId, quote: "今天先核对日志" });
  expect(replaced.view.directives).toHaveLength(1);
  const withdrawn = await submitDirective(actor, c.id, { ...input, commandId: "withdraw", expectedSeq: 2, operation: "WITHDRAW", directiveId: event.directiveId });
  expect(withdrawn.view.directives).toHaveLength(0); expect(withdrawn.view.intentHash).not.toBe(first.view.intentHash);
});
test("suppression follows card roots into artifacts; unknown and cyclic provenance cannot be independent evidence", async () => {
  const { actor, a, c } = await fixture();
  const capture = await db.capture.create({ data: { projectId: a.id, rawText: "原始记录" } });
  const card = await db.knowledgeCard.create({ data: { projectId: a.id, captureId: capture.id, type: "meeting_note", title: "摘要", summary: "模型摘要", keywords: [], relatedTasks: [], nextActions: [], importance: 1 } });
  const artifact = await db.generatedArtifact.create({ data: { projectId: a.id, artifactType: "weekly_report", content: "二手结论", sourceRefs: { sources: [{ sourceId: "card:" + card.id, projectId: a.id }] } } });
  await submitDirective(actor, c.id, { ...command(a.id), operation: "SUPPRESS_USE", sourceIds: ["capture:" + capture.id] });
  for (const id of ["capture:" + capture.id, "card:" + card.id, "artifact:" + artifact.id]) expect((await sourceUse(actor.userId, a.id, id)).state).toBe("SUPPRESSED");
  const unmapped = await db.generatedArtifact.create({ data: { projectId: a.id, artifactType: "weekly_report", content: "无来源的总结" } });
  expect(await sourceUse(actor.userId, a.id, "artifact:" + unmapped.id)).toMatchObject({ state: "UNKNOWN", independentEvidence: false });
  const raw = await db.capture.create({ data: { projectId: a.id, rawText: "另一条可重新核对的原始记录" } });
  const cyclic = await db.knowledgeCard.create({ data: { projectId: a.id, captureId: raw.id, type: "meeting_note", title: "不能独立引用的摘要", summary: "二手结论", keywords: [], relatedTasks: [], nextActions: [], importance: 1 } });
  await db.cardRelation.create({ data: { currentCardId: cyclic.id, relatedCardId: cyclic.id, relationType: "DERIVED_FROM", score: 1, reason: "synthetic cycle" } });
  expect((await sourceUse(actor.userId, a.id, "card:" + cyclic.id)).state).toBe("UNKNOWN");
  const pointers = await discoverMaterialPointers(actor, [a.id], []);
  expect(pointers.some(p => p.sourceId === "capture:" + raw.id)).toBe(true);
  expect(pointers.some(p => p.sourceId === "capture:" + capture.id)).toBe(false);
});
