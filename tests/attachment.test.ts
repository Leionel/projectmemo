import { afterEach, describe, it, expect } from "vitest";
import { processAttachmentUpload } from "@/lib/services/attachmentService";
import { db } from "@/lib/db";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const originalAttachmentDir = process.env.ATTACHMENT_DIR;
const temporaryDirs: string[] = [];

afterEach(() => {
  if (originalAttachmentDir === undefined) delete process.env.ATTACHMENT_DIR;
  else process.env.ATTACHMENT_DIR = originalAttachmentDir;
  for (const dir of temporaryDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("S05: Project Inbox Attachment Upload and Memory Ingestion", () => {
  it("stores an unreadable PDF truthfully and deduplicates before writing another file", async () => {
    const attachmentDir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-attachments-"));
    temporaryDirs.push(attachmentDir);
    process.env.ATTACHMENT_DIR = attachmentDir;
    const testProject = await db.project.create({
      data: {
        title: "Attachment Inbox Test Project",
        description: "Testing PDF and image inbox",
        goal: "Verify attachment to memory pipeline",
        scenario: "RESEARCH",
      },
    });

    try {
      const mockFileBuffer = Buffer.from(
        "%PDF-1.4 BT (消融对比实验分析报告) ET BT (对比 Baseline 准确率提升 4.2%) ET"
      );

      const result = await processAttachmentUpload({
        projectId: testProject.id,
        fileName: "ablation_report.pdf",
        mimeType: "application/pdf",
        buffer: mockFileBuffer,
      });

      expect(result.attachment).toBeDefined();
      expect(result.attachment.type).toBe("PDF");
      expect(result.attachment.sha256).toBeTruthy();
      expect(result.isDuplicate).toBe(false);
      expect(result.attachment.extractionStatus).not.toBe("SUCCESS");
      expect(result.card).toBeNull();
      expect(fs.readdirSync(attachmentDir)).toHaveLength(1);

      // 测试同文件二次上传去重
      const duplicateResult = await processAttachmentUpload({
        projectId: testProject.id,
        fileName: "ablation_report.pdf",
        mimeType: "application/pdf",
        buffer: mockFileBuffer,
      });

      expect(duplicateResult.isDuplicate).toBe(true);
      expect(duplicateResult.attachment.id).toBe(result.attachment.id);
      expect(fs.readdirSync(attachmentDir)).toHaveLength(1);
    } finally {
      await db.project.delete({ where: { id: testProject.id } });
    }
  });

  it("rejects executable content instead of archiving it as a generic file", async () => {
    const testProject = await db.project.create({
      data: {
        title: "Attachment Validation Project",
        description: "Reject unsupported files",
        goal: "Keep the inbox safe",
        scenario: "RESEARCH",
      },
    });
    try {
      await expect(processAttachmentUpload({
        projectId: testProject.id,
        fileName: "payload.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("MZ-not-an-allowed-attachment"),
      })).rejects.toThrow("Only PDF and image attachments are supported");
    } finally {
      await db.project.delete({ where: { id: testProject.id } });
    }
  });
});
