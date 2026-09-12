import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { analyzeChangeImpact, confirmChangeImpact } from "@/lib/services/changeImpactService";
import { completeProjectAction } from "@/lib/services/actionService";

describe("Change Impact Analysis and Temporal Supersession", () => {
  let projectId: string;
  let oldCardId: string;
  let oldActionId: string;

  beforeAll(async () => {
    // 创建一个隔离测试项目
    const project = await db.project.create({
      data: {
        title: "决策变更测试项目",
        description: "用于验证时态影响分析与原子替代闭环",
        goal: "完成复赛方案验证",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;

    // 创建原决策方案A
    const capture = await db.capture.create({
      data: {
        projectId,
        rawText: "选型方案A：采用大型全参数密集模型开展微调",
        sourceType: "组会决策",
      },
    });

    const card = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title: "选型方案A：采用大型密集模型开展微调",
        summary: "采用全参数方案进行训练评估",
        keywords: JSON.stringify(["方案A", "模型"]),
        relatedTasks: JSON.stringify([]),
        nextActions: JSON.stringify([]),
        importance: 4,
      },
    });
    oldCardId = card.id;

    // 创建基于方案A的待办
    const action = await db.actionItem.create({
      data: {
        projectId,
        sourceCardId: oldCardId,
        title: "训练方案A基模并测试显存占用",
        status: "TODO",
        priority: 2,
      },
    });
    oldActionId = action.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  it("analyzes impact and detects superseded card and impacted actions", async () => {
    const proposal = await analyzeChangeImpact(
      projectId,
      "显存超标，选型方案A改为轻量量化方案B，截止时间提前"
    );

    expect(proposal.proposalId).toBeDefined();
    expect(proposal.supersededCardId).toBe(oldCardId);
    expect(proposal.impactedActions.length).toBeGreaterThanOrEqual(1);
    expect(proposal.impactedActions[0].targetId).toBe(oldActionId);
    expect(proposal.impactedActions[0].proposedAction).toBe("CANCEL");
  });

  it("confirms change impact atomically by superseding card and cancelling actions", async () => {
    const proposal = await analyzeChangeImpact(
      projectId,
      "确认显存不足，原方案A作废，全面切换为轻量量化方案B"
    );

    const result = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "确认显存不足，原方案A作废，全面切换为轻量量化方案B",
      supersededCardId: proposal.supersededCardId,
      cancelledActionIds: [oldActionId],
      newActions: [
        {
          title: "配置方案B量化管线并验证准确率",
          description: "4-bit 量化适配测试",
          priority: 1,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.cancelledCount).toBe(1);
    expect(result.createdActionsCount).toBe(1);

    // 验证数据库内时态关系
    const relation = await db.cardRelation.findFirst({
      where: {
        currentCardId: result.newCardId,
        relatedCardId: oldCardId,
        relationType: "SUPERSEDES",
      },
    });
    expect(relation).not.toBeNull();
    expect(relation?.confirmed).toBe(true);

    // 验证旧行动已变更为 CANCELLED
    const updatedAction = await db.actionItem.findUnique({
      where: { id: oldActionId },
    });
    expect(updatedAction?.status).toBe("CANCELLED");

    // 验证新行动已创建并处于 TODO
    const newAction = await db.actionItem.findFirst({
      where: { projectId, sourceCardId: result.newCardId },
    });
    expect(newAction).not.toBeNull();
    expect(newAction?.status).toBe("TODO");
    expect(newAction?.priority).toBe(1);
  });

  it("does not mark unrelated actions for cancellation", async () => {
    const unrelatedAction = await db.actionItem.create({
      data: {
        projectId,
        title: "报销差旅费用",
        status: "TODO",
        priority: 3,
      },
    });

    try {
      const proposal = await analyzeChangeImpact(
        projectId,
        "模型方案改为方案C进行快速验证"
      );

      const isMarked = proposal.impactedActions.some(
        (act) => act.targetId === unrelatedAction.id
      );
      expect(isMarked).toBe(false);
    } finally {
      await db.actionItem.delete({ where: { id: unrelatedAction.id } }).catch(() => {});
    }
  });

  it("rejects bogus proposalId with 404", async () => {
    await expect(
      confirmChangeImpact(projectId, {
        proposalId: "bogus-fake-proposal-id",
        newFactText: "伪造提案内容进行提交",
        supersededCardId: oldCardId,
      })
    ).rejects.toThrow();
  });

  it("rejects cross-project supersededCardId with 400", async () => {
    // 创建另一个项目及其卡片
    const otherProject = await db.project.create({
      data: {
        title: "另一个项目",
        description: "测试跨项目隔离",
        goal: "隔离",
        scenario: "COMPETITION",
      },
    });

    try {
      const otherCapture = await db.capture.create({
        data: {
          projectId: otherProject.id,
          rawText: "外部项目事实",
          sourceType: "组会决策",
        },
      });

      const otherCard = await db.knowledgeCard.create({
        data: {
          projectId: otherProject.id,
          captureId: otherCapture.id,
          type: "meeting_note",
          title: "外部项目卡片",
          summary: "外部项目事实",
          keywords: ["外部"],
          relatedTasks: [],
          nextActions: [],
          importance: 3,
        },
      });

      const proposal = await analyzeChangeImpact(
        projectId,
        "新决策提议，试图关联外部项目卡片"
      );

      await expect(
        confirmChangeImpact(projectId, {
          proposalId: proposal.proposalId,
          newFactText: "新决策提议，试图关联外部项目卡片",
          supersededCardId: otherCard.id, // 跨项目非法引用！
        })
      ).rejects.toThrow();
    } finally {
      await db.project.delete({ where: { id: otherProject.id } }).catch(() => {});
    }
  });

  it("idempotently returns previous result without creating duplicate cards on repeat submission", async () => {
    const proposal = await analyzeChangeImpact(
      projectId,
      "正式变更方案并验证幂等确认机制"
    );

    const first = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "正式变更方案并验证幂等确认机制",
    });

    const second = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "正式变更方案并验证幂等确认机制",
    });

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(first.newCardId).toBe(second.newCardId);
    expect((second as { alreadyConfirmed?: boolean }).alreadyConfirmed).toBe(true);
  });

  it("completes an action created from change impact and produces a reflection card without keywords type error", async () => {
    const proposal = await analyzeChangeImpact(
      projectId,
      "闭环测试：全面切换至自适应蒸馏方案"
    );

    const result = await confirmChangeImpact(projectId, {
      proposalId: proposal.proposalId,
      newFactText: "闭环测试：全面切换至自适应蒸馏方案",
      newActions: [
        {
          title: "运行自适应蒸馏收敛测试",
          description: "验证行动闭环与复盘卡生成",
          priority: 2,
        },
      ],
    });

    const action = await db.actionItem.findFirst({
      where: { projectId, sourceCardId: result.newCardId },
    });
    expect(action).not.toBeNull();

    // 完成行动，验证不会发生 card.keywords.filter is not a function 崩溃
    const completion = await completeProjectAction(
      projectId,
      action!.id,
      "自适应蒸馏在第 15 个 epoch 完成收敛，各项指标符合预期"
    );

    expect(completion.status).toBe("DONE");
    expect(completion.resultCard).toBeDefined();
    expect(completion.resultCard?.summary).toContain("自适应蒸馏");
  });

  it("should reject payload tampering with PROPOSAL_PAYLOAD_MISMATCH or UNAUTHORIZED_CANCEL_ACTION", async () => {
    // 1. 生成正常提案
    const proposal = await analyzeChangeImpact(
      projectId,
      "选型方案A改为方案B：采用端侧轻量化蒸馏模型"
    );
    expect(proposal.proposalId).toBeDefined();

    // 2. 负向测试 A：篡改事实描述 newFactText
    await expect(
      confirmChangeImpact(projectId, {
        proposalId: proposal.proposalId,
        newFactText: "偷换为未经预览的事实描述",
      })
    ).rejects.toThrow("提交的变更事实描述与提案预览不一致");

    // 3. 负向测试 B：篡改被取代卡片 supersededCardId
    const anotherCapture = await db.capture.create({
      data: { projectId, rawText: "同项目另一张卡片", sourceType: "测试" },
    });
    const anotherCard = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: anotherCapture.id,
        type: "meeting_note",
        title: "另一张不相干的卡片",
        summary: "摘要",
        keywords: ["测试"],
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });

    await expect(
      confirmChangeImpact(projectId, {
        proposalId: proposal.proposalId,
        newFactText: proposal.newFactText,
        supersededCardId: anotherCard.id,
      })
    ).rejects.toThrow("指定的被取代卡片与提案预览不一致");

    // 4. 负向测试 C：夹带未在预览中允许取消的无关任务
    const unrelatedAction = await db.actionItem.create({
      data: {
        projectId,
        title: "报销差旅费用",
        status: "TODO",
        priority: 1,
      },
    });

    await expect(
      confirmChangeImpact(projectId, {
        proposalId: proposal.proposalId,
        newFactText: proposal.newFactText,
        cancelledActionIds: [unrelatedAction.id],
      })
    ).rejects.toThrow("未在提案预览允许取消范围内");
  });

  it("should accurately match superseded card in multi-card distractor environment", async () => {
    // 准备干扰环境：
    // 卡片 1: "模型方案A：采用全参数密集模型"
    // 卡片 2: "每周例会与团建组织安排"（晚于卡片1创建）
    const targetCapture = await db.capture.create({
      data: { projectId, rawText: "模型方案A：全参数密集模型", sourceType: "方案" },
    });
    const targetCard = await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: targetCapture.id,
        type: "meeting_note",
        title: "模型方案A：全参数密集模型",
        summary: "方案A细节",
        keywords: ["模型方案A"],
        relatedTasks: [],
        nextActions: [],
        importance: 4,
      },
    });

    const distractorCapture = await db.capture.create({
      data: { projectId, rawText: "每周例会与团建组织安排", sourceType: "日常" },
    });
    await db.knowledgeCard.create({
      data: {
        projectId,
        captureId: distractorCapture.id,
        type: "meeting_note",
        title: "每周例会与团建组织安排",
        summary: "会议日常",
        keywords: ["例会", "团建"],
        relatedTasks: [],
        nextActions: [],
        importance: 2,
      },
    });

    // 针对 "模型方案A改为模型方案B" 进行影响分析
    const analysis = await analyzeChangeImpact(
      projectId,
      "模型方案A改为模型方案B：采用蒸馏小模型"
    );

    // 验证选中的是被替代的 targetCard，而不是最新创建的 distractorCard
    expect(analysis.supersededCardId).toBe(targetCard.id);
    expect(analysis.supersededCardTitle).toBe(targetCard.title);
  });
});

describe("Change impact matching disambiguation (R0)", () => {
  async function createIsolatedProject(title: string) {
    const project = await db.project.create({
      data: {
        title,
        description: "R0 匹配歧义防护用例",
        goal: "回归防护",
        scenario: "COMPETITION",
      },
    });
    return project;
  }

  async function createCard(projectId: string, title: string, keywords: string[]) {
    const capture = await db.capture.create({
      data: { projectId, rawText: title, sourceType: "测试" },
    });
    return db.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title,
        summary: title,
        keywords,
        relatedTasks: [],
        nextActions: [],
        importance: 3,
      },
    });
  }

  it("same-title cards yield ambiguity candidates instead of auto-supersession", async () => {
    const project = await createIsolatedProject("同名卡歧义测试项目");
    try {
      const card1 = await createCard(project.id, "模型方案A:全参数密集模型微调", ["模型方案A"]);
      const card2 = await createCard(project.id, "模型方案A:全参数密集模型微调", ["模型方案A"]);

      // 两张同名卡得分必然并列：系统不得自动选定取代目标，只能给出候选
      const proposal = await analyzeChangeImpact(project.id, "将模型方案A:全参数密集模型微调改为方案B");
      expect(proposal.supersededCardId).toBeNull();
      expect(proposal.ambiguousCandidateIds).toBeDefined();
      expect(proposal.ambiguousCandidateIds).toHaveLength(2);
      expect(proposal.ambiguousCandidateIds).toContain(card1.id);
      expect(proposal.ambiguousCandidateIds).toContain(card2.id);

      // 非候选卡片即使属于本项目也不允许指定为被取代对象
      const outsider = await createCard(project.id, "完全无关的会议记录", ["会议"]);
      await expect(
        confirmChangeImpact(project.id, {
          proposalId: proposal.proposalId,
          newFactText: "将模型方案A:全参数密集模型微调改为方案B",
          supersededCardId: outsider.id,
        })
      ).rejects.toThrow("指定的被取代卡片与提案预览不一致");

      // 用户从候选集合中明确选择后允许确认，且另一张候选卡保持活跃
      const result = await confirmChangeImpact(project.id, {
        proposalId: proposal.proposalId,
        newFactText: "将模型方案A:全参数密集模型微调改为方案B",
        supersededCardId: card1.id,
      });
      expect(result.success).toBe(true);
      expect(result.supersededCardId).toBe(card1.id);

      const relation = await db.cardRelation.findFirst({
        where: { currentCardId: result.newCardId, relatedCardId: card1.id, relationType: "SUPERSEDES" },
      });
      expect(relation).not.toBeNull();

      const relationsForCard2 = await db.cardRelation.count({ where: { relatedCardId: card2.id } });
      expect(relationsForCard2).toBe(0);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("superseded card is excluded from matching until its supersession relation is revoked", async () => {
    const project = await createIsolatedProject("失效卡匹配测试项目");
    try {
      const baseCard = await createCard(project.id, "方案S:初始基线方案", ["方案S"]);
      const newerCard = await createCard(project.id, "团队例会纪要与排期安排", ["例会"]);

      await db.cardRelation.create({
        data: {
          currentCardId: newerCard.id,
          relatedCardId: baseCard.id,
          relationType: "SUPERSEDES",
          reason: "测试：取代基线方案",
          score: 100,
          confidence: 1.0,
          confirmed: true,
          confirmedAt: new Date(),
          validFrom: new Date(),
        },
      });

      // 输入完整包含旧卡标题（若未过滤必得高分），但已取代的旧卡不得再作为自动取代目标
      const analysis = await analyzeChangeImpact(
        project.id,
        "方案S:初始基线方案作废，直接采用方案T:量化管线"
      );
      expect(analysis.supersededCardId).toBeNull();

      // 撤销取代关系后，旧决策恢复有效，可以重新被匹配
      await db.cardRelation.updateMany({
        where: { currentCardId: newerCard.id, relatedCardId: baseCard.id, relationType: "SUPERSEDES" },
        data: { revokedAt: new Date() },
      });

      const analysisAfterRevoke = await analyzeChangeImpact(
        project.id,
        "方案S:初始基线方案替换为方案T:量化管线"
      );
      expect(analysisAfterRevoke.supersededCardId).toBe(baseCard.id);
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });

  it("near-title distractor: the explicitly named card wins without ambiguity", async () => {
    const project = await createIsolatedProject("相近标题测试项目");
    try {
      const namedCard = await createCard(project.id, "模型方案A:全参数微调", ["模型方案A"]);
      await createCard(project.id, "模型方案A2:轻量微调", ["模型方案A2"]);

      const analysis = await analyzeChangeImpact(project.id, "模型方案A:全参数微调替换为方案B");
      expect(analysis.supersededCardId).toBe(namedCard.id);
      expect(analysis.ambiguousCandidateIds).toBeUndefined();
    } finally {
      await db.project.delete({ where: { id: project.id } }).catch(() => {});
    }
  });
});
