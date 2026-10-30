import { E2E_DATABASE_URL, E2E_ENV, E2E_USERNAME } from "./e2e-env";
if (process.env.DATABASE_URL !== E2E_DATABASE_URL) throw new Error("UX2 fixture 只能使用隔离 E2E 库");
Object.assign(process.env, E2E_ENV);
const { db } = await import("../lib/db");
const { emptyBlocks } = await import("../lib/conversation/repository");
const { sourceHash } = await import("../lib/mission/repository");
const { publishConversationDigest } = await import("../lib/memory/conversationDigest");
const { createSession } = await import("../lib/auth/session");
const content = "目前52ms是用户报告，尚未完成目标设备测量。";
try {
  const conversation = await db.conversation.findUniqueOrThrow({ where: { id: process.argv[2] === "memory" ? process.argv[3] : process.argv[2] }, include: { owner: true } });
  if (conversation.owner.username !== E2E_USERNAME || !conversation.homeProjectId) throw new Error("只允许隔离 E2E 身份与项目");
  const projectId = conversation.homeProjectId;
  const append = (turnId: string | null, blocks: Record<string, unknown>) => db.$transaction(async tx => {
    const current = await tx.conversation.update({ where: { id: conversation.id }, data: { nextSeq: { increment: 1 } } });
    return tx.agentMessage.create({ data: { conversationId: current.id, ownerUserId: current.ownerUserId, projectId, seq: current.nextSeq, turnId,
      role: "ASSISTANT", content, citations: [], proposedActions: [], blocksJson: { ...emptyBlocks(), provider: "UX2_SCRIPTED_FIXTURE", ...blocks } } });
  });
  if (process.argv[2] !== "memory") {
    const message = await append(null, { observedProjectIds: [projectId] });
    console.log(JSON.stringify({ messageId: message.id, content }));
  } else {
    const capture = await db.capture.create({ data: { projectId, rawText: "安装日志完整，目标设备启动日志缺失。" } });
    const source = { sourceId: "capture:" + capture.id, projectId, revision: await sourceHash(projectId, "capture:" + capture.id), excerpt: capture.rawText,
      title: "安装记录", kind: "PROJECT" as const, citationNumber: 1 };
    const revision = (await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { contextRevision: true } })).contextRevision;
    const turn = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: crypto.randomUUID(), inputHash: "ux2-memory",
      inputJson: { message: "启动结果如何" }, baseVersion: 1, status: "GENERATING", leaseUntil: new Date(Date.now() + 60000),
      readManifestJson: { sourceRevisionReadSet: [{ projectId, revision, role: "OWNER" }] } } });
    const message = await append(turn.id, { observedProjectIds: [projectId], sources: [source] });
    const synthesis = { summary: "目标设备启动结果仍未知，先核对启动日志。", conditions: ["当前只有安装日志"], retainedReasons: ["安装与启动是不同结果"],
      openQuestions: ["缺目标设备启动日志"], commitments: [],
      hypotheses: [{ statement: "目标设备可能已经启动过", conditions: ["同一台演示设备"], state: "PROPOSED" as const,
        explanation: "安装完成但缺少启动记录", nextInformationNeed: "读取目标设备的启动日志",
        evidence: [{ sourceId: "capture:" + capture.id, role: "SUPPORT" as const, quote: "安装日志完整" }] }] };
    const sessionId = (await createSession(conversation.ownerUserId)).session.id;
    await db.$transaction(tx => publishConversationDigest(tx, { userId: conversation.ownerUserId, sessionId, conversationId: conversation.id },
      message.id, projectId, synthesis, [source] as never, [projectId]));
    await db.conversationTurn.update({ where: { id: turn.id }, data: { status: "ANSWERED", finishedAt: new Date(), leaseUntil: null } });
    console.log(JSON.stringify({ messageId: message.id, content, summary: synthesis.summary, hypothesis: synthesis.hypotheses[0].statement, projectId }));
  }
} finally { await db.$disconnect(); }
