import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { requireProject } from "@/lib/repositories/projects";
import type { ChangeImpactProposal, ChangeImpactItem, ConfirmChangeInput } from "@/lib/types/decisionImpact";
import { Prisma } from "@/lib/generated/prisma/client";
import { isFeatureEnabled } from "@/lib/config/features";
import { refreshProjectState } from "@/lib/services/projectStateService";

// 内存暂存提案，方便快速内存比对
const pendingProposals = new Map<string, ChangeImpactProposal>();

export interface SupersedeCandidateCard {
  id: string;
  title: string;
}

export interface SupersedePickResult {
  /** 得分最高且唯一时才返回；歧义或低于门槛时为 null，由用户手动指定 */
  card: SupersedeCandidateCard | null;
  /** 最高分并列的候选（含 card 本身）；供 UI 列出候选 */
  tieCandidateIds: string[];
}

/**
 * 被取代卡片匹配（R0/T1 共享）：输入完整包含标题、语法提取目标、关键词重合与公共子串四类信号。
 * 置信门槛 30 分；最高分并列说明无法唯一确定，不得自动取代。
 */
export function pickSupersedeCard(candidates: SupersedeCandidateCard[], text: string): SupersedePickResult {
  const trimmed = text.trim();
  let best: SupersedeCandidateCard | null = null;
  let maxScore = 0;
  let ties: string[] = [];

  const changePatternMatch = trimmed.match(/(?:将|从)?(.+?)(?:改为|替换为|调整为|转为|升级为|变更为|取代)(.+)/);
  const targetEntity = changePatternMatch ? changePatternMatch[1].trim() : "";
  const keywords = ["方案", "模型", "架构", "算法", "组件", "系统"];

  for (const card of candidates) {
    let score = 0;
    const title = card.title;
    if (!title) continue;

    if (trimmed.includes(title)) {
      score += 100 + title.length * 10;
    }
    if (targetEntity) {
      if (title === targetEntity) {
        score += 120;
      } else if (title.includes(targetEntity) || targetEntity.includes(title)) {
        score += 80 + Math.min(title.length, targetEntity.length) * 10;
      }
    }
    for (const kw of keywords) {
      if (trimmed.includes(kw) && title.includes(kw)) {
        score += 15;
      }
    }
    let lcs = 0;
    for (let len = Math.min(title.length, 12); len >= 2; len--) {
      for (let i = 0; i <= title.length - len; i++) {
        const sub = title.substring(i, i + len);
        if (trimmed.includes(sub)) {
          lcs = Math.max(lcs, len);
          break;
        }
      }
      if (lcs > 0) break;
    }
    if (lcs >= 2) {
      score += lcs * 8;
    }

    if (score > maxScore) {
      maxScore = score;
      best = card;
      ties = [card.id];
    } else if (score === maxScore && score > 0) {
      ties.push(card.id);
    }
  }

  if (maxScore < 30) {
    return { card: null, tieCandidateIds: [] };
  }
  if (ties.length > 1) {
    return { card: null, tieCandidateIds: ties };
  }
  return { card: best, tieCandidateIds: ties };
}

export async function analyzeChangeImpact(projectId: string, newFactText: string): Promise<ChangeImpactProposal> {
  await requireProject(projectId);
  const trimmed = newFactText.trim();
  if (trimmed.length < 5) {
    throw new AppError("INVALID_INPUT", "变更描述请至少输入 5 个字", 422);
  }

  // 1. 查询项目现有知识卡片
  const cards = await db.knowledgeCard.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: {
      incomingLinks: { where: { relationType: "SUPERSEDES", confirmed: true, revokedAt: null } },
    },
  });

  // 过滤出当前仍活跃（未被取代）的卡片
  const activeCards = cards.filter((c) => c.incomingLinks.length === 0);

  // 2. 匹配可能被替代的原决策卡片（共享匹配函数，T1 会议文本复用同一规则）
  const picked = pickSupersedeCard(
    activeCards.map((card) => ({ id: card.id, title: card.title.trim() })),
    trimmed,
  );
  const supersededCard = picked.card
    ? activeCards.find((card) => card.id === picked.card?.id) ?? null
    : null;
  const ambiguousCandidateIds = picked.tieCandidateIds.length > 1 ? picked.tieCandidateIds : undefined;


  // 3. 检索受影响的待办行动 (TODO 或 DOING)
  const actions = await db.actionItem.findMany({
    where: {
      projectId,
      status: { in: ["TODO", "DOING"] },
    },
  });

  const impactedActions: ChangeImpactItem[] = [];
  for (const act of actions) {
    // 仅基于明确关系判断：待办直接源自被取代卡片，或待办标题明确提及旧卡片标题前缀
    const isDirectlyRelated = supersededCard
      ? act.sourceCardId === supersededCard.id ||
        (supersededCard.title.length >= 2 && act.title.includes(supersededCard.title.substring(0, Math.min(6, supersededCard.title.length))))
      : false;

    if (isDirectlyRelated) {
      impactedActions.push({
        id: `impact-act-${act.id}`,
        type: "ACTION",
        targetId: act.id,
        title: act.title,
        impactReason: supersededCard
          ? `该行动基于原决策【${supersededCard.title}】，新决策将导致其前提失效`
          : "方案变更影响正在执行的任务前提",
        proposedAction: "CANCEL",
        confirmed: true,
      });
    }
  }

  // 4. 检索受影响的成果章节
  const artifacts = await db.generatedArtifact.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    take: 3,
  });

  const impactedArtifacts: ChangeImpactItem[] = [];
  for (const art of artifacts) {
    impactedArtifacts.push({
      id: `impact-art-${art.id}`,
      type: "ARTIFACT",
      targetId: art.id,
      title: `${art.artifactType} 成果草稿`,
      impactReason: "所引用的方案选型或关键实验数据已变更，建议重新生成以保证一致性",
      proposedAction: "REGENERATE",
      confirmed: true,
    });
  }

  // 5. 将提案受控持久化到数据库 AgentRun (runType: EVALUATE)
  const run = await db.agentRun.create({
    data: {
      projectId,
      runType: "EVALUATE",
      status: "SUCCESS",
      provider: "change_impact_analyzer",
      trace: {
        newFactText: trimmed,
        supersededCardId: supersededCard ? supersededCard.id : null,
        ambiguousCandidateIds: ambiguousCandidateIds ?? [],
        allowedCancelledActionIds: impactedActions.map((a) => a.targetId),
      },
      resultJson: {
        status: "PENDING",
      },
    },
  });

  const proposalId = `cip_${run.id}`;
  const proposal: ChangeImpactProposal = {
    proposalId,
    projectId,
    newFactText: trimmed,
    supersededCardId: supersededCard ? supersededCard.id : null,
    supersededCardTitle: supersededCard ? supersededCard.title : null,
    ambiguousCandidateIds,
    impactedActions,
    impactedArtifacts,
    summary: supersededCard
      ? `检测到新决策将取代原事实【${supersededCard.title}】，预计影响 ${impactedActions.length} 项待办行动和 ${impactedArtifacts.length} 份成果草稿。`
      : ambiguousCandidateIds && ambiguousCandidateIds.length > 1
        ? `存在 ${ambiguousCandidateIds.length} 张候选卡片可能被新决策取代，请手动选择，系统不做自动取代。`
        : `已生成决策变更影响分析，涉及 ${impactedActions.length} 项待办行动。`,
  };

  await db.agentRun.update({
    where: { id: run.id },
    data: {
      resultJson: {
        status: "PENDING",
        proposal: proposal as unknown as Prisma.InputJsonValue,
      },
    },
  });

  pendingProposals.set(proposalId, proposal);
  return proposal;
}

export async function confirmChangeImpact(projectId: string, input: ConfirmChangeInput) {
  await requireProject(projectId);

  const result = await db.$transaction(async (tx) => {
    // 1. 校验提案受控合法性与项目归属
    const runId = input.proposalId.startsWith("cip_") ? input.proposalId.substring(4) : input.proposalId;
    const run = await tx.agentRun.findFirst({
      where: {
        id: runId,
        projectId,
        runType: "EVALUATE",
        provider: "change_impact_analyzer",
      },
    });

    if (!run) {
      throw new AppError("PROPOSAL_NOT_FOUND", "变更提案不存在或不属于当前项目", 404);
    }

    const runResult = run.resultJson as { status?: string; executionResult?: { newCardId: string; supersededCardId: string | null; cancelledCount: number; createdActionsCount: number } } | null;
    if (runResult?.status === "CONFIRMED" && runResult.executionResult) {
      // 幂等返回首次确认生成的结果，杜绝重复创建新卡片与行动
      return {
        success: true,
        ...runResult.executionResult,
        alreadyConfirmed: true,
      };
    }

    // 2. 提案持久化数据绑定与防篡改校验
    const trace = (run.trace && typeof run.trace === "object" && !Array.isArray(run.trace)
      ? run.trace as Record<string, unknown>
      : {}) as {
      newFactText?: string;
      supersededCardId?: string | null;
      ambiguousCandidateIds?: string[];
      allowedCancelledActionIds?: string[];
    };

    const boundFactText = trace.newFactText?.trim() || "";
    const boundSupersededCardId = trace.supersededCardId ?? null;
    const allowedCancelledIds = new Set(trace.allowedCancelledActionIds || []);

    // 强校验 1：如果调用方传了 newFactText，必须与持久化提案完全一致，严禁偷换内容
    if (input.newFactText && input.newFactText.trim() !== boundFactText) {
      throw new AppError("PROPOSAL_PAYLOAD_MISMATCH", "提交的变更事实描述与提案预览不一致", 400);
    }
    const finalFactText = boundFactText || (input.newFactText ? input.newFactText.trim() : "");

    // 强校验 2：如果调用方传了 supersededCardId，必须与持久化提案完全一致；
    // 例外：提案因最高分并列未自动选定时，允许用户从持久化的歧义候选集合中明确选择
    const inputSuperseded = input.supersededCardId === undefined ? boundSupersededCardId : (input.supersededCardId ?? null);
    if (inputSuperseded !== boundSupersededCardId) {
      const ambiguityCandidates = new Set(trace.ambiguousCandidateIds || []);
      const userSelectionAllowed = boundSupersededCardId === null && inputSuperseded !== null && ambiguityCandidates.has(inputSuperseded);
      if (!userSelectionAllowed) {
        throw new AppError("PROPOSAL_PAYLOAD_MISMATCH", "指定的被取代卡片与提案预览不一致", 400);
      }
    }
    const finalSupersededCardId = inputSuperseded;

    // 强校验 3：取消的行动必须是提案预览允许集合的严格子集，杜绝夹带无关任务
    if (input.cancelledActionIds && input.cancelledActionIds.length > 0) {
      for (const actId of input.cancelledActionIds) {
        if (!allowedCancelledIds.has(actId)) {
          throw new AppError("UNAUTHORIZED_CANCEL_ACTION", `行动项 ${actId} 未在提案预览允许取消范围内`, 400);
        }
      }
    }

    // 3. 跨项目安全校验：若指定了被取代的卡片，必须严格归属于当前项目
    if (finalSupersededCardId) {
      const cardInProject = await tx.knowledgeCard.findFirst({
        where: {
          id: finalSupersededCardId,
          projectId,
        },
      });
      if (!cardInProject) {
        throw new AppError("CROSS_PROJECT_CARD", "被取代的卡片不存在或不属于当前项目", 400);
      }
    }

    // 4. 创建新采集记录与知识卡片（严禁使用 JSON.stringify 存储 Json 数组）
    const capture = await tx.capture.create({
      data: {
        projectId,
        rawText: finalFactText,
        sourceType: "决策变更",
      },
    });

    const newCard = await tx.knowledgeCard.create({
      data: {
        projectId,
        captureId: capture.id,
        type: "meeting_note",
        title: finalFactText.length > 30 ? `${finalFactText.substring(0, 30)}...` : finalFactText,
        summary: finalFactText,
        keywords: ["决策变更", "方案调整", "时态替代"],
        relatedTasks: [],
        nextActions: [],
        importance: 5,
      },
    });

    // 5. 若指定了被取代的卡片，写入 SUPERSEDES 时态关系
    if (finalSupersededCardId) {
      await tx.cardRelation.create({
        data: {
          currentCardId: newCard.id,
          relatedCardId: finalSupersededCardId,
          relationType: "SUPERSEDES",
          reason: `新决策取代旧方案：${finalFactText}`,
          score: 100,
          confidence: 1.0,
          confirmed: true,
          confirmedAt: new Date(),
          validFrom: new Date(),
        },
      });
    }

    // 5. 将确认取消的行动标记为 CANCELLED（限定在当前项目下）
    let cancelledCount = 0;
    if (input.cancelledActionIds && input.cancelledActionIds.length > 0) {
      const updateResult = await tx.actionItem.updateMany({
        where: {
          id: { in: input.cancelledActionIds },
          projectId,
          status: { in: ["TODO", "DOING"] },
        },
        data: {
          status: "CANCELLED",
        },
      });
      cancelledCount = updateResult.count;
    }

    // 6. 若有新提议行动，创建之并绑定到新卡片
    let createdActionsCount = 0;
    if (input.newActions && input.newActions.length > 0) {
      for (const act of input.newActions) {
        await tx.actionItem.create({
          data: {
            projectId,
            sourceCardId: newCard.id,
            title: act.title,
            description: act.description,
            priority: act.priority ?? 3,
            status: "TODO",
          },
        });
        createdActionsCount++;
      }
    }

    const executionResult = {
      newCardId: newCard.id,
      supersededCardId: finalSupersededCardId,
      cancelledCount,
      createdActionsCount,
    };

    // 7. 原子标记提案已执行，记录幂等结果
    await tx.agentRun.update({
      where: { id: run.id },
      data: {
        resultJson: {
          status: "CONFIRMED",
          executionResult: executionResult as unknown as Prisma.InputJsonValue,
          confirmedAt: new Date().toISOString(),
        },
      },
    });

    // 清理内存暂存
    pendingProposals.delete(input.proposalId);

    return {
      success: true,
      ...executionResult,
    };
  });

  // 业务提交已成功；状态未刷新（功能关闭或刷新失败）不得伪装成业务失败，只标记待刷新（进入项目时补偿）
  let stateRefreshPending = true;
  if (isFeatureEnabled("PROJECT_STATE_ENABLED", false)) {
    try {
      await refreshProjectState(projectId);
      stateRefreshPending = false;
    } catch {
      stateRefreshPending = true;
    }
  }
  return { ...result, stateRefreshPending };
}
