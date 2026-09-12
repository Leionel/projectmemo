import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { generateArtifact, saveEditedArtifactVersion } from "@/lib/services/artifactService";
import { getArtifactAudit } from "@/lib/services/artifactAuditService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";

describe("Artifact provenance audit (R1)", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "成果证据审计测试项目",
        description: "验证生成时回执与当前重新检查两个时间口径",
        goal: "R1 验收",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  async function seedCard(title: string) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: `${title} 的摘要`,
        keywords: ["测试"],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
  }

  it("captures generation-time source refs and reports them as still valid on recheck", async () => {
    const card = await seedCard("实验记录：基线模型准确率达到 82%");

    const artifact = await generateArtifact(projectId, "weekly_report");
    expect(artifact.sourceRefs).not.toBeNull();

    const audit = await getArtifactAudit(projectId, artifact.id);
    expect(audit.untraceable).toBe(false);
    expect(audit.generationRefs).toHaveLength(1);
    expect(audit.generationRefs[0].cardId).toBe(card.id);
    expect(audit.generationRefs[0].summarySnapshot).toContain("82%");
    expect(audit.recheck).toHaveLength(1);
    // 独立事实无确认关系：时间线语义为“证据不足”，不得虚构 SUPPORTS；但未被取代
    expect(audit.recheck[0].supportState).toBe("INSUFFICIENT");
    expect(audit.recheck[0].supersededBy).toBeNull();
    expect(audit.message).toContain("未被取代");
    expect(audit.message).toContain("证据不足");
  });

  it("reports historical artifacts without stored refs as untraceable instead of fabricating evidence", async () => {
    const legacy = await db.generatedArtifact.create({
      data: { projectId, artifactType: "weekly_report", content: "# 旧版成果\n\n未保存引用的历史成果" },
    });

    const audit = await getArtifactAudit(projectId, legacy.id);
    expect(audit.untraceable).toBe(true);
    expect(audit.generationRefs).toHaveLength(0);
    expect(audit.recheck).toHaveLength(0);
    expect(audit.message).toContain("无法逐句回溯");
    expect(audit.message).toContain("不会用当前知识库补造历史");
  });

  it("marks human-edited versions as untraceable rather than inheriting generation refs", async () => {
    const artifact = await saveEditedArtifactVersion(projectId, "weekly_report", "# 人工编辑版\n\n手工修改的内容");
    const audit = await getArtifactAudit(projectId, artifact.id);
    expect(audit.untraceable).toBe(true);
  });

  it("reflects supersession in recheck: old card is no longer a current conclusion source", async () => {
    await seedCard("选型方案A：采用大型密集模型");
    const artifact = await generateArtifact(projectId, "competition_outline");

    const proposal = await analyzeChangeImpact(projectId, "选型方案A：采用大型密集模型改为轻量量化方案B");
    const confirmation = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "选型方案A：采用大型密集模型改为轻量量化方案B",
      supersededCardId: proposal.supersededCardId,
    });
    expect(confirmation.success).toBe(true);

    const audit = await getArtifactAudit(projectId, artifact.id);
    const superseded = audit.recheck.find((item) => item.supportState === "SUPERSEDED");
    expect(superseded).toBeDefined();
    expect(superseded?.supersededByTitle).toContain("轻量量化方案B");
    expect(superseded?.supersededConfirmedAt).not.toBeNull();
    expect(superseded?.supersededReason).not.toBeNull();
    expect(audit.message).toContain("已被新决策取代");

    // 撤销取代关系后，重新检查应恢复旧卡的当前有效状态
    const relation = await db.cardRelation.findFirst({
      where: { currentCardId: confirmation.newCardId, relationType: "SUPERSEDES" },
    });
    expect(relation).not.toBeNull();
    await db.cardRelation.update({ where: { id: relation!.id }, data: { revokedAt: new Date() } });

    const auditAfterRevoke = await getArtifactAudit(projectId, artifact.id);
    expect(auditAfterRevoke.recheck.some((item) => item.supportState === "SUPERSEDED")).toBe(false);
  });

  it("rejects artifact ids that do not belong to the project", async () => {
    const otherProject = await db.project.create({
      data: { title: "其他项目", description: "", goal: "", scenario: "COMPETITION" },
    });
    try {
      const foreign = await db.generatedArtifact.create({
        data: { projectId: otherProject.id, artifactType: "weekly_report", content: "外部成果" },
      });
      await expect(getArtifactAudit(projectId, foreign.id)).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: otherProject.id } }).catch(() => {});
    }
  });
});
