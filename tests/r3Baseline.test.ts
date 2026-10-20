process.env.LLM_MODE = "mock";
process.env.PROJECT_REENTRY_ENABLED = "true";
process.env.PROJECT_EPISODES_ENABLED = "true";
process.env.PROJECT_STATE_ENABLED = "true";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { correctAttachmentText } from "@/lib/services/attachmentService";
import { getProjectReentry } from "@/lib/services/projectReentryService";
import { previewProjectEpisode, confirmEpisodeRevision } from "@/lib/services/projectEpisodeService";
import { refreshProjectState } from "@/lib/services/projectStateService";
import { GET as download } from "@/app/api/projects/[id]/attachments/[attachmentId]/file/route";
import { createSession } from "@/lib/auth/session";
import { saveFileToStorage } from "@/lib/storage/attachmentStorage";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const ids: string[] = [];
afterAll(async () => { for (const id of ids) await db.project.delete({ where: { id } }); });
async function fixture() {
  const p = await db.project.create({ data: { title: "R3独立回归", description: "测试", goal: "验证", scenario: "RESEARCH" } }); ids.push(p.id);
  const a = await db.attachment.create({ data: { projectId: p.id, type: "IMAGE", fileName: "test.png", mimeType: "image/png", storageKey: "not-a-real-file", size: 1, sha256: p.id, extractedText: null } });
  return { p, a };
}
describe("R3.0 基线反例", () => {
  it("原件接口返回真实字节且隔离非成员", async () => {
    const { p, a } = await fixture();
    const user = await db.user.create({ data: { username: `r3-${p.id}`, displayName: "测试", passwordHash: "unused" } });
    const original = process.env.ATTACHMENT_DIR;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "r3-download-"));
    try {
      process.env.ATTACHMENT_DIR = temporary;
      const stored = await saveFileToStorage(p.id, "test.png", Buffer.from("原件内容"));
      await db.attachment.update({ where: { id: a.id }, data: { storageKey: stored.storageKey } });
      const { token } = await createSession(user.id);
      const request = new Request("https://test.invalid/file", { headers: { Authorization: `Bearer ${token}` } });
      const context = { params: Promise.resolve({ id: p.id, attachmentId: a.id }) };
      expect((await download(request, context)).status).toBe(404);
      await db.projectMembership.create({ data: { projectId: p.id, userId: user.id } });
      const response = await download(request, context);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("原件内容");
      expect((await download(new Request(request.url), context)).status).toBe(401);
    } finally {
      if (original === undefined) delete process.env.ATTACHMENT_DIR; else process.env.ATTACHMENT_DIR = original;
      fs.rmSync(temporary, { recursive: true, force: true });
      await db.user.delete({ where: { id: user.id } });
    }
  });
  it.each([null, "", "旧版本文本"])("校对基线 %s 并发只提交一次", async (base) => {
    const { p, a } = await fixture();
    await db.attachment.update({ where: { id: a.id }, data: { extractedText: base } });
    const results = await Promise.allSettled([
      correctAttachmentText(p.id, a.id, "甲的校对结果", base),
      correctAttachmentText(p.id, a.id, "乙的校对结果", base),
    ]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("ATTACHMENT_TEXT_CHANGED");
    expect(await db.knowledgeCard.count({ where: { attachmentId: a.id } })).toBe(1);
  });
  it("局部失效后不把该句当当前结论", async () => {
    const { p, a } = await fixture();
    await db.attachmentRevision.create({ data: { attachmentId: a.id, revisionIndex: 0, text: "旧版", source: "EXTRACTION" } });
    const cap = await db.capture.create({ data: { projectId: p.id, rawText: "当前计划", sourceType: "测试" } });
    await db.knowledgeCard.create({ data: { projectId: p.id, captureId: cap.id, type: "idea", title: "计划", summary: "当前计划", importance: 3, keywords: [], nextActions: [], relatedTasks: [] } });
    await refreshProjectState(p.id);
    const preview = await previewProjectEpisode(p.id, { windowStart: new Date(Date.now()-60000).toISOString(), windowEnd: new Date().toISOString() });
    await confirmEpisodeRevision(p.id, preview.episode.id, { revision: 1, requestId: p.id });
    await db.attachmentRevision.create({ data: { attachmentId: a.id, revisionIndex: 1, text: "新版", source: "MANUAL_CORRECTION" } });
    const result = await getProjectReentry(p.id);
    expect(result.episode.keyConclusion).not.toContain("修订 #0");
  });
  it("模拟待办不进入首屏受阻风险", async () => {
    const { p } = await fixture();
    const prerequisite = await db.actionItem.create({ data: { projectId: p.id, title: "前置" } });
    await db.actionItem.create({ data: { projectId: p.id, title: "模拟受阻", isSimulated: true, requirements: { create: [{ projectId: p.id, targetKind: "action", targetId: prerequisite.id, hard: true }] } } });
    expect((await getProjectReentry(p.id)).risk.kind).not.toBe("BLOCKED");
  });
});
