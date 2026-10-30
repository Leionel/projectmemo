import { randomUUID } from "node:crypto";
const url = process.env.DATABASE_URL ?? "";
if (!/harmony-ux2/.test(url)) throw new Error("只允许隔离的 harmony-ux2 验收库");
Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_WEB_ENABLED: "true" });
const { db } = await import("../lib/db");
const { hashPassword } = await import("../lib/auth/password");
const { sourceHash } = await import("../lib/mission/repository");
const { publishConversationDigest } = await import("../lib/memory/conversationDigest");
const { createSession } = await import("../lib/auth/session");
const { emptyBlocks } = await import("../lib/conversation/repository");
try {
  const username = "ux2-acceptance", password = "ux2-acceptance-pass";
  const user = await db.user.create({ data: { username, displayName: "验收测试身份", passwordHash: await hashPassword(password) } });
  const sessionId = (await createSession(user.id)).session.id;
  const project = await db.project.create({ data: { title: "设备启动核对", description: "UX2 模拟器验收项目", goal: "完成目标设备演示", scenario: "RESEARCH",
    memberships: { create: { userId: user.id } } } });
  const second = await db.project.create({ data: { title: "配套资料项目", description: "UX2 模拟器验收项目", goal: "整理安装资料", scenario: "RESEARCH",
    memberships: { create: { userId: user.id } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "安装日志完整，目标设备启动日志缺失。" } });
  const conversation = await db.conversation.create({ data: { ownerUserId: user.id, createRequestId: randomUUID(), createInputHash: "fixture", scope: "PROJECT",
    homeProjectId: project.id, title: "启动结果核对", projects: { create: [{ projectId: project.id }] } } });
  const source = { sourceId: "capture:" + capture.id, projectId: project.id, revision: await sourceHash(project.id, "capture:" + capture.id),
    excerpt: capture.rawText, title: "安装记录", kind: "PROJECT" as const, citationNumber: 1 };
  const revision = (await db.project.findUniqueOrThrow({ where: { id: project.id }, select: { contextRevision: true } })).contextRevision;
  const turn = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: randomUUID(), inputHash: "fixture", inputJson: { message: "启动结果如何" },
    baseVersion: 1, status: "GENERATING", leaseUntil: new Date(Date.now() + 60000), readManifestJson: { sourceRevisionReadSet: [{ projectId: project.id, revision, role: "OWNER" }] } } });
  const message = await db.agentMessage.create({ data: { conversationId: conversation.id, projectId: project.id, ownerUserId: user.id, turnId: turn.id, role: "ASSISTANT", seq: 1,
    content: "目前52ms是用户报告，尚未完成目标设备测量。", citations: [], proposedActions: [],
    blocksJson: { ...emptyBlocks(), observedProjectIds: [project.id], sources: [source], provider: "UX2_EMULATOR_FIXTURE" } } });
  const synthesis = { summary: "目标设备启动结果仍未知，先核对启动日志。", conditions: ["当前只有安装日志"], retainedReasons: ["安装与启动是不同结果"],
    openQuestions: ["缺目标设备启动日志"], commitments: [],
    hypotheses: [{ statement: "目标设备可能已经启动过", conditions: ["同一台演示设备"], state: "PROPOSED" as const,
      explanation: "安装完成但缺少启动记录", nextInformationNeed: "读取目标设备的启动日志",
      evidence: [{ sourceId: "capture:" + capture.id, role: "SUPPORT" as const, quote: "安装日志完整" }] }] };
  await db.$transaction(tx => publishConversationDigest(tx, { userId: user.id, sessionId, conversationId: conversation.id }, message.id, project.id, synthesis,
    [source] as never, [project.id]));
  await db.conversationTurn.update({ where: { id: turn.id }, data: { status: "ANSWERED", finishedAt: new Date(), leaseUntil: null } });
  console.log(JSON.stringify({ username, password, userId: user.id, projectId: project.id, secondProjectId: second.id, conversationId: conversation.id,
    messageId: message.id, summary: synthesis.summary, hypothesis: synthesis.hypotheses[0].statement }, null, 2));
} finally { await db.$disconnect(); }
