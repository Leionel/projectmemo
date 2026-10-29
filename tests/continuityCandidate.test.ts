import { afterAll, afterEach, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("candidate"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation, readConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { previewDirective, submitDirective } from "@/lib/continuity/directiveService";
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });
test.each([true, false])("model interpretation is a candidate only, authenticated quote and exact user control are separate: %s", async validQuote => {
  Object.assign(process.env, { FOCUS_AGENT_R4_ENABLED: "true", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "synthetic-only" });
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "解释候选合成用户", passwordHash: "unused" } });
  const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
  const p = await db.project.create({ data: { title: "项目", description: "synthetic", goal: "原长期目标", scenario: "COMPETITION", memberships: { create: { userId: u.id } } } });
  const c = await createConversation(actor, { requestId: "c", scope: "PROJECT", projectId: p.id });
  const message = "我现在更想把演示先做好", interpretation = "先完善演示，暂缓扩展功能";
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)), stage = request.messages[0].content.match(/^任务 (\S+)/)?.[1];
    const result = stage === "focus.route.v2" ? { intent: "ANSWER", projectIds: [p.id], query: "演示", investigate: false, informationNeeds: [],
      directiveCandidate: { projectId: p.id, quote: validQuote ? message : "用户从未说过的永久目标", interpretation, kind: "WORKING_OBJECTIVE" } }
      : stage === "focus.answer.v2" ? { advice: "可以先核对演示所缺的条件。", observations: [], priorities: [], recommendedProjectId: p.id, action: null }
        : { schemaVersion: 2, intent: "EXPLAIN", primaryIntent: "EXPLAIN", composition: [{ blockKey: "answer", semanticType: "prose", emphasis: "primary", dataRefs: [], text: "先核对演示条件。" }] };
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
  });
  const result = await submitConversationTurn(actor, c.id, { requestId: "ask", expectedVersion: 1, projectId: p.id, message, llmContextApproved: true });
  expect(await db.agentDirectiveEvent.count({ where: { ownerUserId: u.id } })).toBe(0);
  expect(result.conversation.continuity?.workingObjective).toBeNull();
  if (!validQuote) { expect(result.conversation.continuity?.candidate).toBeUndefined(); return; }
  const c2 = await createConversation(actor, { requestId: "next-session", scope: "PROJECT", projectId: p.id });
  const view = await readConversation(actor, c2.id), candidate = view.continuity!.candidate!;
  expect(candidate.quote).toBe(message); expect(candidate.conversationId).toBe(c.id);
  await expect(submitDirective(actor, c2.id, { commandId: "not-confirmed", expectedSeq: 0, scope: { projectId: p.id }, operation: "SET", quote: "今天先完善演示", candidateId: candidate.id })).rejects.toMatchObject({ code: "DIRECTIVE_CONFIRMATION_REQUIRED" });
  const preview = await previewDirective(actor, c2.id, { commandId: "confirmed", expectedSeq: 0, scope: { projectId: p.id }, operation: "SET", quote: interpretation,
    kind: "WORKING_OBJECTIVE", validUntil: new Date(Date.now() + 86400000).toISOString(), candidateId: candidate.id });
  const applied = await submitDirective(actor, c2.id, preview.command);
  expect(applied.events).toHaveLength(1);
  const event = await db.agentDirectiveEvent.findUniqueOrThrow({ where: { id: applied.events[0] } });
  expect(event.sourceJson).toMatchObject({ origin: "EXACT_USER_CONTROL", modelCandidate: { quote: message } });
  expect((await db.project.findUniqueOrThrow({ where: { id: p.id } })).goal).toBe("原长期目标");
  expect((await readConversation(actor, c2.id)).continuity?.candidate).toBeUndefined();
}, 15000);
