import { db } from "@/lib/db";
import { isFeatureEnabled } from "@/lib/config/features";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";
import { AgentRunStatus, AgentRunType, InterventionTrigger } from "@/lib/generated/prisma/client";
import { requireProject } from "@/lib/repositories/projects";
import {
  deleteSimulatedAgentData,
  getProjectMetrics,
  listInterventions,
  saveAgentRun,
  upsertIntervention,
} from "@/lib/repositories/agent";
import { applyInterventionPolicy } from "@/lib/services/interventionPolicyService";
import type { AgentEvidence, ProposedAction } from "@/lib/types";

export type DemoScenario = "deadline_48h" | "stale_72h" | "risk_cluster";

type ContextInput = {
  scenario?: DemoScenario | null;
  clearSimulation?: boolean;
  now?: Date;
};

function asDate(value: Date | string | null | undefined) {
  return value instanceof Date ? value : value ? new Date(value) : null;
}

function daysUntil(deadline: Date, now: Date) {
  return (deadline.getTime() - now.getTime()) / 86_400_000;
}

function action(label: string, title: string, description: string, priority = 3, dueAt?: Date): ProposedAction {
  return {
    kind: "create_action",
    label,
    title,
    description,
    priority,
    ...(dueAt ? { dueAt: dueAt.toISOString() } : {}),
  };
}

function materialAction(projectTitle: string): ProposedAction {
  return {
    kind: "generate_artifact",
    label: "生成作品说明大纲",
    title: `${projectTitle}：先生成一版作品说明大纲`,
    description: "用现有知识卡片填充创意、技术路径和演示证据，再由你确认修改。",
    artifactType: "competition_outline",
    priority: 3,
  };
}

export async function evaluateProjectContext(projectId: string, input: ContextInput = {}) {
  const startedAt = Date.now();
  const now = input.now ?? new Date();
  const project = await requireProject(projectId);
  if (input.clearSimulation) await deleteSimulatedAgentData(projectId);
  const [cards, artifacts, actions] = await Promise.all([
    db.knowledgeCard.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, select: { id: true, type: true, title: true, summary: true, createdAt: true } }),
    db.generatedArtifact.findMany({ where: { projectId }, select: { artifactType: true, createdAt: true } }),
    db.actionItem.findMany({ where: { projectId }, select: { id: true, sourceCardId: true, sourceInterventionId: true, status: true, updatedAt: true } }),
  ]);
  const simulated = Boolean(input.scenario);
  const effectiveDeadline = input.scenario === "deadline_48h"
    ? new Date(now.getTime() + 48 * 60 * 60 * 1000)
    : asDate(project.deadline);
  const latestDates = [
    asDate(project.updatedAt),
    ...cards.map((card) => asDate(card.createdAt)),
    ...artifacts.map((artifact) => asDate(artifact.createdAt)),
    ...actions.map((item) => asDate(item.updatedAt)),
  ].filter((value): value is Date => Boolean(value));
  const latestActivity = latestDates.sort((a, b) => b.getTime() - a.getTime())[0] ?? now;
  const effectiveStaleAt = input.scenario === "stale_72h"
    ? new Date(now.getTime() - 72 * 60 * 60 * 1000 - 60_000)
    : latestActivity;

  const matches: Array<{
    triggerType: InterventionTrigger;
    dedupeKey: string;
    severity: number;
    title: string;
    content: string;
    evidence: AgentEvidence;
    proposedActions: ProposedAction[];
    evidenceCardId?: string | null;
  }> = [];

  if (effectiveDeadline) {
    const remaining = daysUntil(effectiveDeadline, now);
    if (remaining <= 14) {
      const severity = remaining <= 1 ? 5 : remaining <= 3 ? 4 : remaining <= 7 ? 3 : 2;
      matches.push({
        triggerType: InterventionTrigger.DEADLINE_NEAR,
        dedupeKey: simulated ? "sim:deadline_48h" : "deadline-near",
        severity,
        title: remaining < 0 ? "截止日期已经过去" : `距离截止还有 ${Math.max(1, Math.ceil(remaining))} 天`,
        content: remaining < 0
          ? "项目已经超过截止日期，建议立即锁定最小可交付版本并补齐提交材料。"
          : "Agent 根据项目截止日期和当前材料覆盖情况，建议把交付拆成今天可完成的行动。",
        evidence: {
          rule: "deadline_within_14_days",
          facts: [`截止时间：${effectiveDeadline.toLocaleString("zh-CN")}`, `剩余约 ${Math.max(0, Math.round(remaining * 10) / 10)} 天`],
          artifactTypes: artifacts.map((item) => String(item.artifactType)),
          evaluatedAt: now.toISOString(),
        },
        proposedActions: [action("创建交付行动", "锁定最小可交付版本并列出提交清单", "明确本轮必须保留的功能、演示路径和提交文件。", severity, effectiveDeadline)],
      });
    }
  }

  const riskCards = cards.filter((card) => String(card.type) === "risk");
  const openRisk = riskCards.find((card) => !actions.some((item) => item.sourceCardId === card.id && ["DONE", "CANCELLED"].includes(String(item.status))));
  if (openRisk || (input.scenario === "risk_cluster" && riskCards.length === 0)) {
    const card = openRisk ?? riskCards[0];
    matches.push({
      triggerType: InterventionTrigger.RISK_UNHANDLED,
      dedupeKey: simulated ? "sim:risk-cluster" : "risk-unhandled",
      severity: 5,
      title: "发现尚未闭环的项目风险",
      content: "风险卡片还没有对应的完成结果。先把影响范围、最小规避方案和验证标准写成一个行动项。",
      evidence: {
        rule: "risk_without_completed_action",
        facts: [card ? `风险卡片：${card.title}` : "演示场景模拟了一组风险卡片"],
        cardIds: card ? [card.id] : [],
        evaluatedAt: now.toISOString(),
      },
      proposedActions: [action("创建风险行动", "评估风险影响并完成最小规避验证", "记录影响范围、负责人、截止时间与验证结果。", 5)],
      evidenceCardId: card?.id,
    });
  }

  const staleHours = (now.getTime() - effectiveStaleAt.getTime()) / 3_600_000;
  const hasOpenActions = actions.some((item) => ["TODO", "DOING"].includes(String(item.status)));
  if (staleHours >= 72 && (hasOpenActions || input.scenario === "stale_72h")) {
    matches.push({
      triggerType: InterventionTrigger.PROJECT_STALE,
      dedupeKey: simulated ? "sim:stale-72h" : "project-stale",
      severity: 3,
      title: "项目已经超过 72 小时没有推进",
      content: "Agent 没有看到新的捕获、成果或行动回执。建议用一条最小记录重新启动项目节奏。",
      evidence: {
        rule: "no_project_activity_for_72_hours",
        facts: [`最近活动：${effectiveStaleAt.toLocaleString("zh-CN")}`, `停滞约 ${Math.round(staleHours)} 小时`],
        evaluatedAt: now.toISOString(),
      },
      proposedActions: [action("恢复项目节奏", "用 15 分钟完成一次最小推进并记录结果", "补充当前进展、阻塞点和下一步，不要求一次完成全部工作。", 3)],
    });
  }

  const paperCount = cards.filter((card) => String(card.type) === "paper_note").length;
  const experimentCount = cards.filter((card) => String(card.type) === "experiment_log").length;
  if (paperCount >= 2 && experimentCount === 0) {
    matches.push({
      triggerType: InterventionTrigger.EXPERIMENT_GAP,
      dedupeKey: "experiment-gap",
      severity: 3,
      title: "论文方法还没有对应实验记录",
      content: "已有论文或方法卡片，但还没有实验日志。补一个可复现的最小基线，才能让结论进入成果。",
      evidence: {
        rule: "paper_notes_without_experiment_log",
        facts: [`论文/方法卡片 ${paperCount} 张`, "实验记录 0 张"],
        cardIds: cards.filter((card) => String(card.type) === "paper_note").map((card) => card.id),
        evaluatedAt: now.toISOString(),
      },
      proposedActions: [action("记录最小实验", "补充一个可复现基线实验", "记录数据、配置、指标和结论，后续再扩展对照组。", 3)],
    });
  }

  const hasRequirement = cards.some((card) => String(card.type) === "requirement");
  const hasOutline = artifacts.some((artifact) => String(artifact.artifactType) === "competition_outline");
  if (hasRequirement && !hasOutline) {
    matches.push({
      triggerType: InterventionTrigger.MATERIAL_GAP,
      dedupeKey: "material-gap",
      severity: 2,
      title: "参赛要求已有记录，但作品说明还未生成",
      content: "Agent 已找到材料要求卡片，建议先生成一版作品说明大纲，再逐项补齐证据。",
      evidence: {
        rule: "requirement_without_competition_outline",
        facts: ["存在参赛要求卡片", "尚未生成作品说明大纲"],
        cardIds: cards.filter((card) => String(card.type) === "requirement").map((card) => card.id),
        evaluatedAt: now.toISOString(),
      },
      proposedActions: [materialAction(project.title)],
    });
  }

  // S06: DELIVERABLE_GAP 评估。保留可回滚开关，关闭时不改变旧规则。
  if (isFeatureEnabled("DELIVERABLE_GAP_ENABLED", true)) {
    const milestones = await db.milestone.findMany({
      where: { projectId, status: "IN_PROGRESS" },
      include: { deliverables: { include: { evidences: true } } },
    });

    for (const milestone of milestones) {
      for (const deliverable of milestone.deliverables) {
        if (deliverable.status === "COMPLETED") continue;
        let expectedTypes: string[] = [];
        try {
          const parsed = JSON.parse(deliverable.expectedEvidence);
          expectedTypes = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
        } catch {
          expectedTypes = [];
        }

        if (expectedTypes.length > 0) {
          const missingTypes = getMissingEvidenceTypes(expectedTypes, deliverable.evidences);

          if (missingTypes.length > 0) {
            matches.push({
              triggerType: InterventionTrigger.DELIVERABLE_GAP,
              dedupeKey: `deliverable-gap-${deliverable.id}`,
              severity: 4,
              title: `交付物【${deliverable.title}】存在证据缺口`,
              content: `里程碑【${milestone.title}】中的关键交付物要求具备相应支撑证据，目前尚缺少：${missingTypes.join("、")}。建议立即补充相应记录。`,
              evidence: {
                rule: "deliverable_missing_expected_evidence",
                facts: [
                  `交付目标：${deliverable.title}`,
                  `期望证据类型：${expectedTypes.join("、")}`,
                  `当前缺失证据：${missingTypes.join("、")}`,
                ],
                cardIds: deliverable.evidences
                  .filter((evidence) => evidence.confirmed && evidence.cardId)
                  .map((evidence) => evidence.cardId as string),
                evaluatedAt: now.toISOString(),
              },
              proposedActions: [
                action(
                  "补充交付物证据",
                  `补充【${deliverable.title}】的${missingTypes[0]}记录`,
                  `记录相关实验数据、技术设计或复盘文档，消除证据链缺口。`,
                  4
                ),
              ],
            });
          }
        }
      }
    }
  }

  if (input.scenario === "risk_cluster" && !matches.some((item) => item.triggerType === InterventionTrigger.RISK_UNHANDLED)) {
    // The simulation must still be visible for a clean project without inventing a real card.
    matches.push({
      triggerType: InterventionTrigger.RISK_UNHANDLED,
      dedupeKey: "sim:risk-cluster",
      severity: 5,
      title: "模拟：风险集中出现",
      content: "这是演示情境：Agent 模拟检测到多条风险同时未处理，数据不会计入真实效果指标。",
      evidence: { rule: "demo_risk_cluster", facts: ["模拟风险数量：3", "isSimulated=true"], evaluatedAt: now.toISOString() },
      proposedActions: [action("处理模拟风险", "把三条风险拆成一个验证行动", "完成后可清除模拟数据，不会污染真实项目。", 5)],
    });
  }

  // B1：真实候选先过预算/静默/去重管道，FIRE 才生成提醒；演示候选绕过管道，不计入真实指标。
  // SUPPRESS 决策保留完整原因（DUPLICATE/SNOOZED/QUIET_HOURS/BUDGET_EXHAUSTED/...）可追溯。
  const saved: Awaited<ReturnType<typeof upsertIntervention>>[] = [];
  if (isFeatureEnabled("INTERVENTION_BUDGET_ENABLED", false)) {
    const candidates = matches.map((match) => ({
      candidateKey: `${String(match.triggerType)}:${match.dedupeKey}`,
      triggerType: String(match.triggerType),
      dedupeKey: match.dedupeKey,
      severity: match.severity,
      title: match.title,
      content: match.content,
      evidenceFacts: match.evidence.facts,
      evidenceCardIds: [
        ...(Array.isArray(match.evidence.cardIds) ? match.evidence.cardIds : []),
        ...(match.evidenceCardId ? [match.evidenceCardId] : []),
      ],
      evidenceRule: String(match.evidence.rule ?? ""),
      proposedActions: match.proposedActions as unknown as Array<Record<string, unknown>>,
      isSimulated: match.dedupeKey.startsWith("sim:"),
    }));
    const outcomes = await applyInterventionPolicy(projectId, candidates, now);
    const firedIds = outcomes
      .filter((outcome) => outcome.decision === "FIRE" && outcome.interventionId)
      .map((outcome) => outcome.interventionId as string);
    const fired = firedIds.length > 0
      ? await db.agentIntervention.findMany({ where: { id: { in: firedIds } } })
      : [];
    for (const intervention of fired) saved.push(intervention);
    // 演示候选由管道直接放行但不落库，这里补齐原有 upsert 行为
    const simulatedMatches = matches.filter((match) => match.dedupeKey.startsWith("sim:"));
    for (const match of simulatedMatches) {
      const intervention = await upsertIntervention({ projectId, ...match, isSimulated: true });
      saved.push(intervention);
    }
  } else {
    const legacy = await Promise.all(matches.map((match) => upsertIntervention({
      projectId,
      ...match,
      isSimulated: match.dedupeKey.startsWith("sim:"),
    })));
    for (const item of legacy) saved.push(item);
  }
  const run = await saveAgentRun({
    projectId,
    runType: AgentRunType.EVALUATE,
    status: AgentRunStatus.SUCCESS,
    provider: "rules",
    trace: {
      engine: "context-event-rules",
      matchedRules: matches.map((match) => match.evidence.rule),
      evidenceCount: matches.reduce((total, match) => total + match.evidence.facts.length, 0),
      simulated: Boolean(input.scenario),
    },
    durationMs: Date.now() - startedAt,
  });
  const interventions = await listInterventions(projectId);
  return { interventions, created: saved, run, metrics: await getProjectMetrics(projectId) };
}
