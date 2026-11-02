import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { continuityDatabase } from "./helpers/continuityDatabase";
import fs from "node:fs";
import path from "node:path";
const isolated = continuityDatabase("s0-deletion");
process.env.ATTACHMENT_DIR = path.join(isolated.dir, "attachments");
let db: typeof import("@/lib/db").db;
let remove: typeof import("@/app/api/projects/[id]/route").DELETE;
beforeAll(async () => { db = (await import("@/lib/db")).db; remove = (await import("@/app/api/projects/[id]/route")).DELETE; });
afterAll(async () => { await db.$disconnect(); void isolated; });
describe("项目销毁的服务端权限", () => {
  async function owned() {
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await db.project.create({ data: { title: "合成清理项目", goal: "验证清理", description: "隔离库与临时目录", scenario: "RESEARCH" } });
    const auth = await createTestAuth(project.id);
    const headers = { ...auth.headers, "X-Project-Delete-Confirmation": project.id, "If-Match": project.updatedAt.toISOString() };
    const request = () => remove(new Request(`http://localhost/api/projects/${project.id}`, { method: "DELETE", headers }), { params: Promise.resolve({ id: project.id }) });
    return { project, auth, headers, request };
  }
  it("普通 MEMBER 不能通过直接 DELETE 销毁共享项目", async () => {
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await db.project.create({ data: { title: "合成共享项目", goal: "验证销毁权限", description: "独立测试库中的安全负例", scenario: "RESEARCH" } });
    const member = await createTestAuth(project.id);
    await db.projectMembership.update({ where: { userId_projectId: { userId: member.user.id, projectId: project.id } }, data: { role: "MEMBER" } });
    const result = await remove(new Request(`http://localhost/api/projects/${project.id}`, { method: "DELETE", headers: member.headers }), { params: Promise.resolve({ id: project.id }) });
    expect(result.status).toBe(403);
    expect(await db.project.findUnique({ where: { id: project.id } })).not.toBeNull();
  });
  it("缺少确认或旧版本不得停用；角色在事务中重新校验", async () => {
    const f = await owned();
    const missing = await remove(new Request("http://localhost", { method: "DELETE", headers: f.auth.headers }), { params: Promise.resolve({ id: f.project.id }) });
    expect(missing.status).toBe(428);
    await db.project.update({ where: { id: f.project.id }, data: { goal: "已经变化的目标", updatedAt: new Date(+f.project.updatedAt + 1000) } });
    expect((await f.request()).status).toBe(409);
    expect(await db.projectMembership.count({ where: { projectId: f.project.id } })).toBe(1);
  });
  it("认证通过后、删除事务前撤销 OWNER，旧请求不得删除项目", async () => {
    const f = await owned();
    const guard = await import("@/lib/auth/guard"), authenticate = guard.authenticateUser;
    let entered!: () => void, resume!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const barrier = new Promise<void>(resolve => { resume = resolve; });
    const spy = vi.spyOn(guard, "authenticateUser").mockImplementationOnce(async request => { const actor = await authenticate(request); entered(); await barrier; return actor; });
    const pending = f.request();
    await ready;
    await db.projectMembership.update({ where: { userId_projectId: { userId: f.auth.user.id, projectId: f.project.id } }, data: { role: "MEMBER" } });
    resume();
    const response = await pending; spy.mockRestore();
    expect(response.status).toBe(403);
    expect((await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).deletionRequestedAt).toBeNull();
  });
  it("清理失败后项目保持停用、文件清单和回执可重试；成功才报告完成", async () => {
    const f = await owned();
    const { saveFileToStorage, deleteAttachmentFile } = await import("@/lib/storage/attachmentStorage");
    const file = await saveFileToStorage(f.project.id, "synthetic.pdf", Buffer.from("synthetic-only"));
    await db.attachment.create({ data: { projectId: f.project.id, type: "PDF", fileName: "synthetic.pdf", mimeType: "application/pdf", storageKey: file.storageKey, size: file.size, sha256: file.sha256 } });
    const initial = await f.request();
    expect(initial.status).toBe(202);
    const receipt = (await initial.json()).deletion.receiptId;
    expect(await db.projectMembership.count({ where: { projectId: f.project.id } })).toBe(0);
    const { reserveCloudCall } = await import("@/lib/auth/cloudQuota");
    await expect(reserveCloudCall(f.project.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    const { sourceUse } = await import("@/lib/continuity/sourcePolicy");
    expect(await sourceUse(f.auth.user.id, f.project.id, `attachment:${file.storageKey}`)).toMatchObject({ state: "SUPPRESSED" });
    const { requireProject } = await import("@/lib/repositories/projects");
    await expect(requireProject(f.project.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
    const { processProjectDeletions, projectDeletionStatus } = await import("@/lib/services/projectDeletionService");
    await processProjectDeletions(5, async () => { throw new Error("synthetic unlink failure"); });
    expect(await projectDeletionStatus(f.auth.user.id, f.project.id)).toMatchObject({ status: "PENDING", filesRemaining: 1 });
    expect(fs.existsSync(file.absolutePath)).toBe(true);
    expect((await (await f.request()).json()).deletion.receiptId).toBe(receipt);
    await processProjectDeletions(5, deleteAttachmentFile);
    expect(fs.existsSync(file.absolutePath)).toBe(false);
    expect(await db.project.findUnique({ where: { id: f.project.id } })).toBeNull();
    expect(await projectDeletionStatus(f.auth.user.id, f.project.id)).toMatchObject({ status: "COMPLETED", filesRemaining: 0 });
    expect((await f.request()).status).toBe(200);
    await expect(projectDeletionStatus("other-owner", f.project.id)).rejects.toMatchObject({ status: 404 });
  });
  it("上传已登记但解析在途时删除：不发布迟到结果，不遗留原文件", async () => {
    const f = await owned();
    const { processAttachmentUpload } = await import("@/lib/services/attachmentService");
    let entered!: () => void, release!: (text: string) => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const extraction = new Promise<string>(resolve => { release = resolve; });
    const upload = processAttachmentUpload({ projectId: f.project.id, fileName: "fixture.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-SYNTHETIC") },
      { extractPdf: async () => { entered(); return extraction; } });
    const outcome = upload.catch(error => error);
    await ready;
    // 用户在上传登记完成后确认当前项目版本，解析仍由屏障保持在途。
    f.headers["If-Match"] = (await db.project.findUniqueOrThrow({ where: { id: f.project.id } })).updatedAt.toISOString();
    expect((await f.request()).status).toBe(202);
    const { processProjectDeletions } = await import("@/lib/services/projectDeletionService");
    await processProjectDeletions();
    release("迟到的合成材料正文");
    expect(await outcome).toMatchObject({ code: "PROJECT_NOT_FOUND" });
    expect(await db.knowledgeCard.count({ where: { projectId: f.project.id } })).toBe(0);
    expect(fs.readdirSync(process.env.ATTACHMENT_DIR!).filter(file => file.startsWith(f.project.id + "_"))).toEqual([]);
  });
});
