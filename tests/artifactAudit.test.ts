import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { generateArtifact, saveEditedArtifactVersion } from "@/lib/services/artifactService";
import { getArtifactAudit } from "@/lib/services/artifactAuditService";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";
import { Prisma } from "@/lib/generated/prisma/client";

describe("Artifact provenance audit (R1)", () => {
  let projectId: string;

  async function weeklyAuditClaims(pid: string, artifactId: string): Promise<string[]> {
    const claimAudit = await getArtifactAudit(pid, artifactId);
    return claimAudit.claims.map((claim) => claim.text);
  }

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
    expect(audit.recheck[0].topLevelState).toBe("UNKNOWN");
    expect(audit.recheck[0].reasonCode).toBe("NO_SUPPORTING_EVIDENCE");
    expect(audit.recheck[0].evidenceRefs.some((ref) => ref.entityId === card.id)).toBe(true);
    expect(audit.recheck[0].supersededBy).toBeNull();

    // E3：模板路径自带逐句映射，独立事实的引用诚实标注“尚无确认支撑”
    expect(audit.claimsStatus).toBe("TEMPLATE_BOUND");
    expect(audit.claims).toHaveLength(1);
    expect(audit.claims[0].cardIds).toEqual([card.id]);
    expect(audit.claims[0].state).toBe("UNCONFIRMED");
    expect(audit.claims[0].stateLabel).toContain("尚无确认支撑");
    expect(audit.message).toContain("逐句映射 1 条");
    expect(audit.message).toContain("尚无确认支撑");
  });

  it("binds per-sentence claims only to the cards each section rendered", async () => {
    await seedCard("实验记录：完成端侧推理时延测试");
    await seedCard("任务：准备复赛演示环境");
    const outline = await generateArtifact(projectId, "competition_outline");
    const weekly = await generateArtifact(projectId, "weekly_report");

    const outlineAudit = await getArtifactAudit(projectId, outline.id);
    expect(outlineAudit.claimsStatus).toBe("TEMPLATE_BOUND");
    expect(outlineAudit.claims.length).toBeGreaterThanOrEqual(2);
    // claim 文本逐字出现在成果正文中（正文定位可验证）
    for (const claim of outlineAudit.claims) {
      expect(outline.content).toContain(claim.text);
    }
    // 周报与大纲的 claim 各自绑定本类型模板渲染的卡片，互不冒充
    for (const claimText of await weeklyAuditClaims(projectId, weekly.id)) {
      expect(weekly.content).toContain(claimText);
    }
  });

  it("reports unmapped model artifacts as semantically unverified", async () => {
    await seedCard("记录：完成基线实验");
    const artifact = await generateArtifact(projectId, "weekly_report");
    // 模拟 LLM 路径：有上下文来源但没有逐句映射
    await db.generatedArtifact.update({
      where: { id: artifact.id },
      data: { claims: { status: "UNMAPPED_MODEL", claims: [] } as object },
    });

    const audit = await getArtifactAudit(projectId, artifact.id);
    expect(audit.untraceable).toBe(false);
    expect(audit.claimsStatus).toBe("UNMAPPED_MODEL");
    expect(audit.claims).toHaveLength(0);
    expect(audit.message).toContain("语义未核验");
  });

  it("marks pre-claim artifacts as legacy context-only provenance", async () => {
    await seedCard("历史卡：早期实验记录");
    const artifact = await generateArtifact(projectId, "weekly_report");
    await db.generatedArtifact.update({ where: { id: artifact.id }, data: { claims: Prisma.JsonNull } });

    const audit = await getArtifactAudit(projectId, artifact.id);
    expect(audit.untraceable).toBe(false);
    expect(audit.claimsStatus).toBe("LEGACY_NO_CLAIMS");
    expect(audit.claims).toHaveLength(0);
    expect(audit.message).toContain("上下文级");
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
    expect(superseded?.topLevelState).toBe("SUPERSEDED");
    expect(superseded?.evidenceRefs.some((ref) => ref.entityId === superseded.cardId)).toBe(true);
    expect(superseded?.supersededByTitle).toContain("轻量量化方案B");
    expect(superseded?.supersededConfirmedAt).not.toBeNull();
    expect(superseded?.supersededReason).not.toBeNull();
    expect(audit.message).toContain("已被新决策取代");
    // 绑定到被取代卡的逐句映射同步降级
    const supersededClaim = audit.claims.find((claim) => claim.state === "SUPERSEDED");
    expect(supersededClaim).toBeDefined();
    expect(supersededClaim?.text).toContain("选型方案A");

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
