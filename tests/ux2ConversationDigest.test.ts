import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("ux2-conversation-digest"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { publishConversationDigest } from "@/lib/memory/conversationDigest";
import { readEffectiveDigests, composeEffectiveMemory } from "@/lib/memory/digestService";
import { readHypotheses } from "@/lib/memory/hypothesisService";
import { sourceHash } from "@/lib/mission/repository";
import { submitDirective } from "@/lib/continuity/directiveService";
import { enqueueImpact } from "@/lib/decision/impactJobs";
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

test("原讨论答案内发布综合与推测，新讨论实际消费；撤权、抑制与新增输入分别使其失效", async () => {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "对话综合", passwordHash: "fixture" } });
  const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
  const a = await db.project.create({ data: { title: "原项目", goal: "完成演示", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const b = await db.project.create({ data: { title: "依赖项目", goal: "另一目标", description: "fixture", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const capture = await db.capture.create({ data: { projectId: a.id, rawText: "安装日志完整，启动日志缺失。" } });
  const conversation = await db.conversation.create({ data: { ownerUserId: user.id, createRequestId: crypto.randomUUID(), createInputHash: "hash", scope: "GLOBAL", homeProjectId: a.id,
    projects: { create: [{ projectId: a.id }] } } });
  const source = { sourceId: "capture:" + capture.id, projectId: a.id, revision: await sourceHash(a.id, "capture:" + capture.id)!, excerpt: capture.rawText,
    title: "安装记录", kind: "PROJECT" as const, citationNumber: 1 };
  const turn = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: crypto.randomUUID(), inputHash: "hash", inputJson: { message: "启动结果如何" }, baseVersion: 1, status: "GENERATING", leaseUntil: new Date(Date.now() + 60000),
    readManifestJson: { sourceRevisionReadSet: [{ projectId: a.id, revision: 0, role: "OWNER" }] } } });
  const message = await db.agentMessage.create({ data: { conversationId: conversation.id, projectId: a.id, turnId: turn.id, role: "ASSISTANT", ownerUserId: user.id,
    content: "启动结果仍未知。", citations: [], proposedActions: [], blocksJson: { sources: [source], observedProjectIds: [a.id, b.id] } } });
  const synthesis = { summary: "启动结果仍未知，先核对目标设备启动日志。", conditions: ["当前只有安装日志"], retainedReasons: ["安装与启动是不同结果"],
    openQuestions: ["缺目标设备启动日志"], commitments: [],
    hypotheses: [{ statement: "目标设备可能已经启动过", conditions: ["同一台演示设备"], state: "PROPOSED" as const,
      explanation: "安装完成但启动记录缺失", nextInformationNeed: "读取目标设备的启动日志", evidence: [{ sourceId: "capture:" + capture.id, role: "SUPPORT" as const, quote: "安装日志完整" }] }] };
  await db.$transaction(tx => publishConversationDigest(tx, { ...actor, conversationId: conversation.id }, message.id, a.id, synthesis, [source] as never, [a.id, b.id]));

  const view = await readEffectiveDigests(user.id, a.id);
  expect(view.items[0]).toMatchObject({ effectiveState: "CURRENT", sourceConversationId: conversation.id });
  expect((await composeEffectiveMemory(user.id, a.id, "启动", [a.id, b.id])).items[0].synthesis?.summary).toBe(synthesis.summary);
  const hypothesis = (await readHypotheses(user.id, a.id)).items[0];
  expect(hypothesis).toMatchObject({ effectiveStatus: "PROPOSED", statement: "目标设备可能已经启动过" });

  await db.projectMembership.delete({ where: { userId_projectId: { userId: user.id, projectId: b.id } } });
  const restricted = await readEffectiveDigests(user.id, a.id);
  expect(restricted.items[0]).toMatchObject({ effectiveState: "RESTRICTED", synthesis: null });
  expect((await readHypotheses(user.id, a.id)).items[0]).toMatchObject({ effectiveStatus: "RESTRICTED" });
  expect((await composeEffectiveMemory(user.id, a.id, "启动", [a.id, b.id])).items).toHaveLength(0);
  await db.projectMembership.create({ data: { userId: user.id, projectId: b.id } });
  expect((await readEffectiveDigests(user.id, a.id)).items[0].effectiveState).toBe("CURRENT");

  await db.$transaction(tx => enqueueImpact(tx, a.id, "capture:new-fact", ["capture:" + capture.id]));
  expect((await db.project.findUniqueOrThrow({ where: { id: a.id } })).contextRevision).toBe(1);
  expect((await readEffectiveDigests(user.id, a.id)).items[0]).toMatchObject({ effectiveState: "STALE", reason: "PROJECT_INPUT_CHANGED" });
  expect((await composeEffectiveMemory(user.id, a.id, "启动", [a.id, b.id])).items).toHaveLength(0);

  await submitDirective({ ...actor, conversationId: conversation.id }, conversation.id, { commandId: crypto.randomUUID(), expectedSeq: 0,
    scope: { projectId: a.id, conversationId: conversation.id }, operation: "SUPPRESS_USE", kind: "USE_SUPPRESSION",
    quote: "这份安装记录不再作为依据", sourceIds: ["capture:" + capture.id], timezone: "Asia/Shanghai" });
  expect((await readEffectiveDigests(user.id, a.id)).items[0].effectiveState).toBe("STALE");
  expect((await readHypotheses(user.id, a.id)).items[0].reuseAllowed).toBe(false);
  expect(await db.agentContextDigest.count({ where: { ownerUserId: user.id } })).toBe(1);
  expect((await db.project.findUniqueOrThrow({ where: { id: a.id } })).goal).toBe("完成演示");
}, 30000);
