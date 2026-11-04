import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () => (await import("./helpers/continuityDatabase")).continuityDatabase("conversation-attachment"));
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { listProjectAttachments } from "@/lib/services/attachmentService";
import { conversationAttachmentContext, deleteConversationAttachment, listConversationAttachments,
  promoteConversationAttachment, uploadConversationAttachment } from "@/lib/services/conversationAttachmentService";

const storage = fs.mkdtempSync(path.join(os.tmpdir(), "pm-conv-attach-"));
process.env.ATTACHMENT_DIR = storage;
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); fs.rmSync(storage, { recursive: true, force: true }); });

// 1x1 PNG：不配置视觉服务时只保存原件，文字标为待识别。
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function fixture(scope: "PROJECT" | "WORKSPACE") {
  const u = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "合成附件用户", passwordHash: "unused" } });
  const p = await db.project.create({ data: { title: "附件对照", goal: "核对讨论附件范围", description: "SYNTHETIC", scenario: "RESEARCH", memberships: { create: { userId: u.id } } } });
  const actor = { userId: u.id, sessionId: (await createSession(u.id)).session.id };
  const c = await createConversation(actor, scope === "PROJECT" ? { requestId: "c", scope: "PROJECT", projectId: p.id } : { requestId: "c", scope: "WORKSPACE" });
  return { u, p, actor, c };
}

test("仅用于对话的附件不进入项目附件，上传与读取都只认讨论所有者", async () => {
  const f = await fixture("PROJECT");
  const { attachment } = await uploadConversationAttachment(f.actor, f.c.id, { fileName: "白板.png", mimeType: "image/png", buffer: png });
  expect(attachment.extractionStatus).not.toBe("SUCCESS");
  expect(await listConversationAttachments(f.actor, f.c.id)).toHaveLength(1);
  expect(await listProjectAttachments(f.p.id)).toHaveLength(0);
  const other = await fixture("PROJECT");
  await expect(listConversationAttachments(other.actor, f.c.id)).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  const again = await uploadConversationAttachment(f.actor, f.c.id, { fileName: "白板副本.png", mimeType: "image/png", buffer: png });
  expect(again.isDuplicate).toBe(true);
});

test("跨项目讨论未选项目时图片不调用识别并说明原因；只认 PDF 与图片", async () => {
  const f = await fixture("WORKSPACE");
  const { attachment } = await uploadConversationAttachment(f.actor, f.c.id, { fileName: "截图.png", mimeType: "image/png", buffer: png });
  expect(attachment.extractionError).toContain("未选择项目");
  await expect(uploadConversationAttachment(f.actor, f.c.id, { fileName: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hello") })).rejects.toThrow();
});

test("本轮附件文字只给模型；保存的用户消息只追加文件名；已移除的附件不能再引用", async () => {
  const f = await fixture("PROJECT");
  const { attachment } = await uploadConversationAttachment(f.actor, f.c.id, { fileName: "白板.png", mimeType: "image/png", buffer: png });
  await db.conversationAttachment.update({ where: { id: attachment.id }, data: { extractedText: "合成白板内容：先补演示结果", extractionStatus: "SUCCESS", extractionError: null } });
  const context = await conversationAttachmentContext(f.c.id, f.u.id, [attachment.id]);
  expect(context.text).toContain("合成白板内容");
  expect((await conversationAttachmentContext(f.c.id, crypto.randomUUID(), [attachment.id])).text).toBe("");
  await submitConversationTurn(f.actor, f.c.id, { requestId: "t1", expectedVersion: 1, projectId: f.p.id, message: "看看这张图", attachmentIds: [attachment.id] }, undefined, { defer: true });
  const stored = await db.agentMessage.findFirstOrThrow({ where: { conversationId: f.c.id, role: "USER" } });
  expect(stored.content).toBe("看看这张图\n\n附件：《白板.png》");
  expect(stored.content).not.toContain("合成白板内容");
  const g = await fixture("PROJECT");
  const removed = (await uploadConversationAttachment(g.actor, g.c.id, { fileName: "白板.png", mimeType: "image/png", buffer: png })).attachment;
  await deleteConversationAttachment(g.actor, g.c.id, removed.id);
  await expect(submitConversationTurn(g.actor, g.c.id, { requestId: "t2", expectedVersion: 1, projectId: g.p.id, message: "再看看", attachmentIds: [removed.id] }, undefined, { defer: true }))
    .rejects.toMatchObject({ code: "ATTACHMENT_NOT_FOUND" });
});

test("转为项目资料后进入项目附件并移除讨论副本", async () => {
  const f = await fixture("PROJECT");
  const { attachment } = await uploadConversationAttachment(f.actor, f.c.id, { fileName: "白板.png", mimeType: "image/png", buffer: png });
  const promoted = await promoteConversationAttachment(f.actor, f.c.id, attachment.id, f.p.id);
  expect(promoted.attachment.projectId).toBe(f.p.id);
  expect(await listProjectAttachments(f.p.id)).toHaveLength(1);
  expect(await listConversationAttachments(f.actor, f.c.id)).toHaveLength(0);
});
