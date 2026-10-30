import { randomUUID } from "node:crypto";
const url = process.env.DATABASE_URL ?? "";
if (!/harmony-ux2/.test(url)) throw new Error("只允许隔离的 harmony-ux2 验收库");
const { db } = await import("../lib/db");
const { emptyBlocks } = await import("../lib/conversation/repository");
try {
  const user = await db.user.findFirstOrThrow({ where: { username: "ux2-acceptance" } });
  const project = await db.project.findFirstOrThrow({ where: { title: "设备启动核对" } });
  const conversation = await db.conversation.findFirstOrThrow({ where: { homeProjectId: project.id } });
  const existing = await db.agentMessage.findFirst({ where: { conversationId: conversation.id, role: "USER" } });
  if (!existing) {
    await db.agentMessage.create({ data: { conversationId: conversation.id, projectId: project.id, ownerUserId: user.id, role: "USER", seq: 0,
      content: "启动结果核对得怎么样了？帮我接着推进。", citations: [], proposedActions: [],
      blocksJson: { ...emptyBlocks(), observedProjectIds: [project.id] } } });
  }
  const missionExists = await db.agentMission.findFirst({ where: { projectId: project.id } });
  if (!missionExists) {
    await db.agentMission.create({ data: { projectId: project.id, ownerUserId: user.id, createRequestId: randomUUID(), createPayloadHash: "fixture",
      goal: "根据安装与启动日志，形成设备演示是否达标的带来源结论。", successCriteriaJson: [], constraintsJson: {}, budgetJson: {}, budgetUsedJson: {}, status: "PAUSED",
      pauseReason: "等待补充目标设备的启动日志后再继续" } });
  }
  console.log(JSON.stringify({ ok: true }));
} finally { await db.$disconnect(); }
