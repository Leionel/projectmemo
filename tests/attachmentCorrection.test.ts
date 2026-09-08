import { describe, it, expect } from "vitest";
import { correctAttachmentText } from "@/lib/services/attachmentService";
import { db } from "@/lib/db";

describe("Module E: Multimodal Attachment Correction & High-Confidence Memory Ingestion", () => {
  it("allows manual correction of unreadable/inaccurate attachment text and creates linked knowledge card", async () => {
    const project = await db.project.create({
      data: {
        title: "Correction Test Project",
        description: "Testing manual proofreading of attachments",
        goal: "Verify correctAttachmentText pipeline",
        scenario: "COMPETITION",
      },
    });

    try {
      // 1. 创建一个模拟的待校对附件（状态 NEEDS_OCR / FAILED）
      const attachment = await db.attachment.create({
        data: {
          projectId: project.id,
          type: "IMAGE",
          storageKey: "test/mock-image.png",
          fileName: "experiment_chart.png",
          mimeType: "image/png",
          size: 1024,
          sha256: "mocksha256_" + Date.now(),
          extractionStatus: "NEEDS_OCR",
          extractionError: "Image OCR requires a configured vision provider",
        },
      });

      expect(attachment.extractionStatus).toBe("NEEDS_OCR");

      // 2. 人工在移动端校对微调输入正确的实验数据
      const correctedText = "消融实验指标修正：轻量方案准确率 98.4%，显存占用从 14GB 降至 5.8GB。";
      const result = await correctAttachmentText(project.id, attachment.id, correctedText);

      expect(result.attachment).toBeDefined();
      expect(result.attachment.extractionStatus).toBe("SUCCESS");
      expect(result.attachment.extractedText).toBe(correctedText);
      expect(result.attachment.extractionError).toBeNull();

      // 3. 验证是否沉淀为真实关联的知识卡片
      expect(result.card).toBeDefined();
      expect(result.card?.projectId).toBe(project.id);

      const dbCard = await db.knowledgeCard.findFirst({
        where: { attachmentId: attachment.id },
      });
      expect(dbCard).toBeDefined();
      expect(dbCard?.summary).toContain("准确率 98.4%");
    } finally {
      await db.project.delete({ where: { id: project.id } });
    }
  });

  it("supersedes the previous attachment card when corrected again", async () => {
    const project = await db.project.create({
      data: {
        title: "Correction Revision Test Project",
        description: "Testing correction revision lineage",
        goal: "Verify corrected facts supersede stale facts",
        scenario: "COMPETITION",
      },
    });

    try {
      const attachment = await db.attachment.create({
        data: {
          projectId: project.id,
          type: "IMAGE",
          storageKey: "test/revision-image.png",
          fileName: "revision-chart.png",
          mimeType: "image/png",
          size: 1024,
          sha256: `revision_${Date.now()}`,
          extractionStatus: "NEEDS_OCR",
        },
      });

      const first = await correctAttachmentText(project.id, attachment.id, "人工校对：准确率 80%。");
      const second = await correctAttachmentText(project.id, attachment.id, "人工复核：准确率 90%。");

      const relation = await db.cardRelation.findFirst({
        where: {
          currentCardId: second.card.id,
          relatedCardId: first.card.id,
          relationType: "SUPERSEDES",
          confirmed: true,
        },
      });

      expect(second.card.id).not.toBe(first.card.id);
      expect(relation).not.toBeNull();
      expect(second.attachment.extractedText).toBe("人工复核：准确率 90%。");
    } finally {
      await db.project.delete({ where: { id: project.id } });
    }
  });
});
