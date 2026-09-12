import { createHash } from "node:crypto";
import { getMissingEvidenceTypes } from "@/lib/milestones/evidenceGap";
import {
  PROJECT_STATE_POLICY_VERSION,
  PROJECT_STATE_SCHEMA_VERSION,
  type BuiltProjectState,
  type ProjectHealth,
  type SnapshotActionState,
  type SnapshotEvidenceRef,
  type SnapshotFact,
  type SnapshotGap,
  type SnapshotRisk,
  type SnapshotSourceInput,
  type SnapshotTruth,
  type SnapshotUnknown,
} from "@/lib/types/projectState";

/** 稳定 JSON 序列化：对象键递归排序，数组由调用方保证键排序，跨进程一致 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function evidenceHash(parts: unknown[]): string {
  return sha256Hex(stableStringify(parts));
}

function cardEvidence(card: { id: string; createdAt: string; title: string; summary: string }, observedAt: string): SnapshotEvidenceRef {
  return {
    entityKind: "card",
    entityId: card.id,
    field: "title+summary",
    observedAt,
    contentHash: evidenceHash([card.title, card.summary]),
  };
}

/** 规则边界：无 deadline 时为 steady；有 deadline 时按 passed/approaching/normal 相位，
 * 跨过边界（纯时间流逝）必须产生新的 evaluationKey，从而生成新的状态行 */
function deadlinePhase(deadline: string | null, now: Date): { evaluationKey: string; passed: boolean; approaching: boolean } {
  if (!deadline) return { evaluationKey: "phase:steady", passed: false, approaching: false };
  const deadlineMs = new Date(deadline).getTime();
  if (Number.isNaN(deadlineMs)) return { evaluationKey: "phase:steady", passed: false, approaching: false };
  const diffDays = (deadlineMs - now.getTime()) / 86400000;
  if (diffDays < 0) return { evaluationKey: `deadline:${deadline}:passed`, passed: true, approaching: false };
  if (diffDays <= 7) return { evaluationKey: `deadline:${deadline}:approaching`, passed: false, approaching: true };
  return { evaluationKey: `deadline:${deadline}:normal`, passed: false, approaching: false };
}

function decisionTruth(item: { hasConfirmedSuperseder: boolean; isConfirmedSuperseder: boolean; hasConfirmedRelation: boolean }): SnapshotTruth {
  if (item.hasConfirmedSuperseder) return "FALSE";
  if (item.isConfirmedSuperseder || item.hasConfirmedRelation) return "TRUE";
  return "UNKNOWN";
}

export function buildProjectState(input: SnapshotSourceInput): BuiltProjectState {
  const now = new Date(input.now);
  const { evaluationKey, passed, approaching } = deadlinePhase(input.deadline, now);

  // ---- facts：仅纳入与非 RELATED 关系相关的卡片（决策演化域）；键排序保证顺序无关
  const factMap = new Map<string, SnapshotFact>();
  const involved = new Map<string, { hasConfirmedSuperseder: boolean; isConfirmedSuperseder: boolean; hasConfirmedRelation: boolean }>();

  for (const relation of input.relations) {
    if (relation.relationType === "RELATED") continue;
    const currentEntry = involved.get(relation.currentCardId) ?? {
      hasConfirmedSuperseder: false,
      isConfirmedSuperseder: false,
      hasConfirmedRelation: false,
    };
    const relatedEntry = involved.get(relation.relatedCardId) ?? {
      hasConfirmedSuperseder: false,
      isConfirmedSuperseder: false,
      hasConfirmedRelation: false,
    };
    if (relation.confirmed && relation.revokedAt === null) {
      if (relation.relationType === "SUPERSEDES") {
        // 取代方向固定为新卡(current) SUPERSEDES 旧卡(related)
        currentEntry.isConfirmedSuperseder = true;
        relatedEntry.hasConfirmedSuperseder = true;
      } else {
        currentEntry.hasConfirmedRelation = true;
        relatedEntry.hasConfirmedRelation = true;
      }
    }
    involved.set(relation.currentCardId, currentEntry);
    involved.set(relation.relatedCardId, relatedEntry);
  }

  const cardById = new Map(input.cards.map((card) => [card.id, card]));
  for (const [cardId, state] of involved) {
    const card = cardById.get(cardId);
    if (!card) continue;
    const truth = decisionTruth(state);
    const temporalStatus = state.hasConfirmedSuperseder ? "SUPERSEDED" : state.isConfirmedSuperseder ? "CURRENT" : "PENDING";
    const evidenceRefs = [cardEvidence(card, input.now)];
    let text: string;
    if (truth === "FALSE") {
      const superseder = input.relations.find((r) =>
        r.relationType === "SUPERSEDES" && r.confirmed && r.revokedAt === null && r.relatedCardId === cardId);
      text = `决策「${card.title}」已被「${superseder?.counterpartTitle ?? "新决策"}」取代`;
    } else if (truth === "TRUE") {
      text = `决策「${card.title}」为当前有效结论`;
    } else {
      text = `决策「${card.title}」存在待确认或未确认的关系`;
    }
    factMap.set(`decision:${cardId}`, {
      key: `decision:${cardId}`,
      text,
      truth,
      temporalStatus,
      evidenceRefs,
      ruleId: "decision.supersession",
    });
  }

  // ---- actions：全量行动及其记录状态（完成检测需要 DONE 也可见）
  const actions: SnapshotActionState[] = input.actions.map((action) => ({
    actionId: action.id,
    title: action.title,
    recordedStatus: action.status,
    resultCardId: action.resultCardId,
    evidenceRefs: [{
      entityKind: "action" as const,
      entityId: action.id,
      field: "status",
      observedAt: action.completedAt ?? input.now,
      contentHash: evidenceHash([action.status, action.resultCardId]),
    }],
  })).sort((a, b) => (a.actionId < b.actionId ? -1 : a.actionId > b.actionId ? 1 : 0));

  // ---- gaps：交付物期望证据与已确认证据的差额（V1 只描述“缺关联证据”，不推断“现实未完成”）
  const gaps: SnapshotGap[] = input.deliverables
    .map((deliverable) => {
      const missingEvidenceTypes = getMissingEvidenceTypes(
        deliverable.expectedEvidenceTypes,
        deliverable.confirmedEvidenceTypes.map((evidenceType) => ({ evidenceType, confirmed: true })),
      );
      return {
        deliverableId: deliverable.id,
        missingEvidenceTypes,
        truth: (missingEvidenceTypes.length > 0 ? "TRUE" : "FALSE") as SnapshotTruth,
        evidenceRefs: [{
          entityKind: "deliverable" as const,
          entityId: deliverable.id,
          field: "expectedEvidence",
          observedAt: input.now,
          contentHash: evidenceHash([deliverable.expectedEvidenceTypes, deliverable.confirmedEvidenceTypes]),
        }],
      };
    })
    .filter((gap) => gap.missingEvidenceTypes.length > 0)
    .sort((a, b) => (a.deliverableId < b.deliverableId ? -1 : a.deliverableId > b.deliverableId ? 1 : 0));

  // ---- risks：仅 deadline 确定性规则
  const risks: SnapshotRisk[] = [];
  if (input.deadline !== null && passed) {
    risks.push({
      stableKey: "risk:deadline:passed",
      text: `项目截止时间 ${input.deadline.substring(0, 10)} 已过`,
      truth: "TRUE",
      severity: "HIGH",
      evidenceRefs: [],
      ruleId: "deadline.passed",
    });
  } else if (input.deadline !== null && approaching) {
    risks.push({
      stableKey: "risk:deadline:approaching",
      text: `项目截止时间 ${input.deadline.substring(0, 10)} 距今不足 7 天`,
      truth: "TRUE",
      severity: "MEDIUM",
      evidenceRefs: [],
      ruleId: "deadline.approaching",
    });
  }

  // ---- unknowns：V1 明确列出已知信息缺口，不猜测
  const unknowns: SnapshotUnknown[] = [];
  if (input.deadline === null) {
    unknowns.push({
      predicate: "deadline.risk",
      text: "未设置项目截止时间，无法判断截止风险",
      missingInputs: ["project.deadline"],
      suggestedInputAction: "在项目设置中补充截止日期",
    });
  }
  unknowns.push({
    predicate: "project.stage",
    text: "系统尚未记录用户确认的项目阶段",
    missingInputs: ["project.stage"],
    suggestedInputAction: "在项目设置中确认当前阶段",
  });

  const health: ProjectHealth = risks.some((risk) => risk.truth === "TRUE") ? "AT_RISK" : "UNKNOWN";

  const facts = [...factMap.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const sortedRisks = risks.sort((a, b) => (a.stableKey < b.stableKey ? -1 : a.stableKey > b.stableKey ? 1 : 0));
  const sortedUnknowns = unknowns.sort((a, b) => (a.predicate < b.predicate ? -1 : a.predicate > b.predicate ? 1 : 0));

  const sourceHash = sha256Hex(stableStringify({
    goal: input.goal,
    deadline: input.deadline,
    cards: input.cards,
    relations: input.relations,
    actions: input.actions,
    deliverables: input.deliverables,
  }));

  const payloadCore = {
    snapshotId: "",
    projectId: input.projectId,
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    goal: input.goal,
    deadline: input.deadline,
    stage: null,
    health,
    facts,
    actions,
    gaps,
    risks: sortedRisks,
    unknowns: sortedUnknowns,
  };

  // contentHash 排除生成时间：同一事实内容重复刷新不构成变化
  const contentHash = sha256Hex(stableStringify(payloadCore));

  return {
    ...payloadCore,
    evaluatedAt: input.now,
    sourceHash,
    contentHash,
    evaluationKey,
  };
}
