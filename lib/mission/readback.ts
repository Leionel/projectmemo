import {isFeatureEnabled} from "@/lib/config/features";
import {missionWorkState} from "./workState";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { artifactTypeLabels } from "@/lib/types";
import { ownedMission, type Tx } from "./repository";
import { materialUseProjection } from "./materialUseProjection";
import { fitContextSummary, type assessEvidenceFit } from "./evidenceFitService";
import { reviewProgressOf } from "./reviewProgress";
import { missionCallCoverageOf } from "./callCoverage";
import { missionResourceUsageOf } from "./resourceUsage";
import { readMissionResponsibility } from "./responsibility";
import { buildMissionWorkPacket, type WorkPacketInput } from "./workPacket";
import type { WorkPacket, WorkPacketEvidenceReviewItem, WorkPacketObservations } from "@/lib/types/workPacket";
import { missionToolLabels } from "./presentation";
export const readTargetSchema = z
  .object({
    questionId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    outputId: z.string().min(1).optional(),
    revision: z.coerce.number().int().positive().optional(),
    receiptId: z.string().min(1).optional(),
    sourceId: z.string().max(180).regex(/^(capture|attachment):.+/).optional(),
  })
  .strict();

const record = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const iso = (v: unknown): string | null => {
  const n = v instanceof Date ? +v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
};
/** 观察事件的有界窗口：最近 21 条原事件，未找到只表示覆盖不足。 */
const OBSERVATION_EVENT_TYPES = ["INVESTIGATION_NO_NEW_INFORMATION", "INVESTIGATION_OBSERVATION_CHANGED", "EXECUTION_STOPPED", "MODEL_PROTOCOL_ERROR"] as const;
const SUCCESS_OBSERVATION_EVENT_TYPES = ["INVESTIGATION_NO_NEW_INFORMATION", "INVESTIGATION_OBSERVATION_CHANGED"] as const;
const FAILURE_EVENT_TYPES = ["EXECUTION_STOPPED", "MODEL_PROTOCOL_ERROR"] as const;
/** 原累计用量的规范键；缺失记为 null（未知），不补 0、不因重启/跨日清零。 */
const USAGE_KEYS = ["models", "tools", "searches", "fetches", "browserRequests", "browserBytes", "calendarRequests", "externalWrites", "metadataRequests", "activeMs", "reservedOutputTokens", "inputTokens", "outputTokens", "unknownCalls"] as const;

type SnapshotVersionFields = {
  version: number; status: string; planRevision: number; contextVersion: number;
  constraintsVersion: number; researchScopeVersion: number; updatedAt: Date;
};
const SNAPSHOT_SELECT = { version: true, status: true, planRevision: true, contextVersion: true, constraintsVersion: true, researchScopeVersion: true, updatedAt: true } as const;

/**
 * 同一只读事务内收集工作包与旧 readback 需要的全部原事实。
 * 不写库、不调模型、不发网络；返回的事务快照版本用于事务外轻量复查。
 */
async function collectMissionBack(
  tx: Tx,
  userId: string,
  id: string,
  input: z.infer<typeof readTargetSchema>,
  now: Date,
) {
  const m = await ownedMission(userId, id, tx);
  const [question, approval, output, receipt, adoptions, origin, steps] =
    await Promise.all([
      input.questionId
        ? tx.agentMissionEvent.findFirst({
            where: { id: input.questionId, missionId: id, type: "QUESTION" },
          })
        : null,
      input.approvalId
        ? tx.agentMissionApproval.findFirst({
            where: { id: input.approvalId, missionId: id },
          })
        : null,
      input.outputId || input.revision
        ? tx.agentMissionOutput.findFirst({
            where: {
              missionId: id,
              ...(input.outputId ? { id: input.outputId } : {}),
              ...(input.revision ? { revision: input.revision } : {}),
            },
          })
        : null,
      input.receiptId
        ? tx.missionArtifactReceipt.findFirst({
            where: {
              id: input.receiptId,
              missionId: id,
              projectId: m.projectId,
            },
          })
        : null,
      tx.missionArtifactReceipt.findMany({
        where: { missionId: id, projectId: m.projectId },
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          artifact: { select: { createdAt: true, artifactType: true } },
        },
      }),
      tx.agentMissionEvent.findFirst({
        where: { missionId: id, type: "COPILOT_HANDOFF" },
        orderBy: { seq: "asc" },
      }),
      tx.agentMissionStep.findMany({
        where: { missionId: id, status: "SUCCEEDED" },
        orderBy: { ordinal: "desc" },
        take: 50,
        select: { resultJson: true },
      }),
    ]);
  if (
    (input.questionId && !question) ||
    (input.approvalId && !approval) ||
    (input.outputId && !output) ||
    (input.revision && !output) ||
    (input.receiptId && !receipt)
  )
    throw new AppError(
      "MISSION_TARGET_NOT_FOUND",
      "原问题、提案或成果版本已不可用，请查看当前委托；不会改为另一项结果",
      404,
    );
  if (
    receipt &&
    ((input.outputId && receipt.outputId !== input.outputId) ||
      (input.revision && receipt.outputRevision !== input.revision))
  )
    throw new AppError(
      "MISSION_TARGET_MISMATCH",
      "回执与指定草稿版本不一致，请从原成果重新进入",
      409,
    );
  const fitRows = await tx.agentMissionEvent.findMany({ where: { missionId: id, type: "EVIDENCE_FIT_REVIEWED" }, orderBy: { seq: "desc" }, take: 21 });
  const selectedQuestionId = input.questionId ?? (m.waitStateJson as { questionId?: string } | null)?.questionId;
  const selectedFitRows = fitRows.slice(0, 20).filter(e => (e.payloadJson as { evidenceFit?: { premise?: { questionId?: string } } }).evidenceFit?.premise?.questionId === selectedQuestionId).slice(0, 3);
  const evidenceReviews = {
    items: selectedFitRows.map(e => ({ eventId: e.id, observedAt: e.createdAt.toISOString(), ...fitContextSummary(e.payloadJson as unknown as NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>)! })),
    truncated: fitRows.length > 20,
  };
  // 工作包只引用原证据审查摘要的确定性字段；truthVerified 恒为 false（不宣称现实成立）。
  const packetEvidenceReviews = {
    items: selectedFitRows.map((e): WorkPacketEvidenceReviewItem => {
      const summary = fitContextSummary(e.payloadJson as unknown as NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>);
      return {
        eventId: e.id,
        observedAt: e.createdAt.toISOString(),
        fitHash: typeof summary?.fitHash === "string" ? summary.fitHash : null,
        fitStatus: typeof summary?.fitStatus === "string" ? summary.fitStatus : null,
        ruleVersion: typeof summary?.ruleVersion === "string" ? summary.ruleVersion : null,
        truthVerified: false,
      };
    }),
    truncated: fitRows.length > 20,
  };
  const actionIdCandidates = steps
    .map(s => (s.resultJson as { data?: { actionId?: string } } | null)?.data?.actionId)
    .filter((x): x is string => !!x);
  const actionIds = actionIdCandidates.slice(0, 5);
  const actions = actionIds.length
    ? await tx.actionItem.findMany({
        where: { id: { in: actionIds }, projectId: m.projectId },
        select: {
          id: true,
          title: true,
          status: true,
          resultCardId: true,
          completedAt: true,
          isSimulated: true,
        },
      })
    : [];
  const sourceRunId = (origin?.payloadJson as { sourceRunId?: string } | null)?.sourceRunId;
  // FS-A03：额度等待事件必须进入投影窗口，detail/summary/readback 才能一致解释 QUEUED。
  const latestEvents = await tx.agentMissionEvent.findMany({ where: { missionId: id, type: { in: ["QUESTION", "INVESTIGATION_NO_NEW_INFORMATION", "DAILY_BUDGET_WAITING"] } }, orderBy: { seq: "desc" }, take: 1 });
  const pendingApprovals = await tx.agentMissionApproval.findMany({ where: { missionId: id, status: "PENDING" } });
  // 进展分类只是既有 Step/Output/Action/回执的只读投影：它不新增完成真值，
  // 也不把工具成功、CI 通过或用户说“完成”换算成现实目标达成。
  const progressOutputs = await tx.agentMissionOutput.findMany({ where: { missionId: id }, orderBy: { revision: "desc" }, take: 4,
    select: { id: true, revision: true, createdAt: true, claimChecksJson: true } });
  const unknownStepCount = await tx.agentMissionStep.count({ where: { missionId: id, status: "UNKNOWN" } });
  const workState = missionWorkState({ ...m, delegationEnabled: isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false), events: latestEvents, approvals: pendingApprovals, unknownSteps: unknownStepCount }, now);
  const reviewProgress = reviewProgressOf({ steps, outputs: progressOutputs, actions, unknownSteps: unknownStepCount });
  // 调用覆盖：只读原 AgentRun/Step，说明哪些调用有回执、哪些用量未知；不是账单。
  const callRunLimit = 20;
  // 先按委托归属筛选，再取窗口；同项目其他讨论不能挤掉本委托的回执。
  const callRunIds = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "AgentRun" WHERE "projectId"=${m.projectId} AND "runType"='CHAT'
      AND json_extract(trace, '$.missionId')=${id}
    ORDER BY "createdAt" DESC, id DESC LIMIT ${callRunLimit + 1}`;
  const [callRuns, callSteps] = await Promise.all([
    tx.agentRun.findMany({ where: { id: { in: callRunIds.map(run => run.id) }, projectId: m.projectId, runType: "CHAT" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, status: true, provider: true, fallbackReason: true, runType: true, trace: true, createdAt: true } }),
    tx.agentMissionStep.findMany({ where: { missionId: id }, orderBy: { ordinal: "desc" }, take: callRunLimit + 1,
      select: { id: true, status: true, toolName: true, toolVersion: true, agentRunId: true } }),
  ]);
  const callCoverage = { ...missionCallCoverageOf({ missionId: id,
    agentRuns: callRuns.map(run => ({ ...run, createdAt: run.createdAt.toISOString() })), steps: callSteps, limit: callRunLimit,
    truncated: callRuns.length > callRunLimit || callSteps.length > callRunLimit }), runScope: "MISSION_FILTERED" as const };
  const wait = m.waitStateJson as { questionId?: string } | null;
  const materialUses = await materialUseProjection(tx, {
    missionId: id, projectId: m.projectId,
    questionId: input.questionId ?? wait?.questionId ?? null, sourceId: input.sourceId, userId,
  });
  // FS-A04：观察时间只从原委托记录/原事件的有界窗口派生，读取绝不推进成功观察时间。
  const observationRows = await tx.agentMissionEvent.findMany({
    where: { missionId: id, type: { in: [...OBSERVATION_EVENT_TYPES] } },
    orderBy: { seq: "desc" }, take: 21, select: { id: true, type: true, seq: true, createdAt: true },
  });
  const delegation = record(record(m.planJson).delegation);
  const latestSuccessObservation = observationRows.find(e => (SUCCESS_OBSERVATION_EVENT_TYPES as readonly string[]).includes(e.type));
  const latestNoNewInformation = observationRows.find(e => e.type === "INVESTIGATION_NO_NEW_INFORMATION");
  const latestFailure = observationRows.find(e => (FAILURE_EVENT_TYPES as readonly string[]).includes(e.type));
  const observationFacts = {
    lastSuccessfulAt: iso(delegation.lastObservedAt) ?? latestSuccessObservation?.createdAt.toISOString() ?? null,
    lastFailedAt: latestFailure?.createdAt.toISOString() ?? null,
    lastNoNewInformationAt: latestNoNewInformation?.createdAt.toISOString() ?? null,
    nextCheckAt: m.nextAttemptAt?.toISOString() ?? null,
  };
  // 责任视图复用同一事务快照；它只读，且不构成第二份授权（原 /responsibility 仍是入口）。
  const responsibility = await readMissionResponsibility(userId, id, tx);
  // 工作包最近工作窗口：包含失败/待批/未知步骤，让“已经做了什么”不只看成功步骤。
  const windowSteps = await tx.agentMissionStep.findMany({
    where: { missionId: id }, orderBy: { ordinal: "desc" }, take: 6,
    select: { id: true, ordinal: true, toolName: true, status: true, finishedAt: true },
  });
  const rawUsed = record(responsibility.budget.additionalUsed);
  const cumulativeUsed = Object.fromEntries(USAGE_KEYS.map(k => {
    const value = rawUsed[k];
    return [k, typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null];
  })) as Record<string, number | null>;
  const limits = Object.fromEntries(Object.entries(record(responsibility.budget.limits)).filter(([, value]) => typeof value === "number" && Number.isFinite(value))) as Record<string, number>;
  const lastError = record(m.lastErrorJson);
  const workPacketInput: Omit<WorkPacketInput, "snapshot"> = {
    mission: {
      missionId: id, projectId: m.projectId, missionVersion: m.version, missionStatus: m.status,
      planRevision: m.planRevision, contextVersion: m.contextVersion, constraintsVersion: m.constraintsVersion, researchScopeVersion: m.researchScopeVersion,
      lastErrorCode: typeof lastError.code === "string" && lastError.code ? lastError.code : null,
      finishedAt: m.finishedAt?.toISOString() ?? null, updatedAt: m.updatedAt.toISOString(),
      pauseRequestedAt: m.pauseRequestedAt?.toISOString() ?? null, cancelRequestedAt: m.cancelRequestedAt?.toISOString() ?? null, pauseReason: m.pauseReason,
    },
    workState,
    responsibility: {
      controlVersion: responsibility.controlVersion,
      permissionState: responsibility.permissionState,
      permissionExpiresAt: responsibility.permissionExpiresAt,
      deadline: responsibility.deadline,
      workerPresence: responsibility.workerPresence,
      effectiveNextCheckAt: responsibility.effectiveNextCheckAt,
      personalMemoryNextBoundary: responsibility.personalMemory.nextBoundary,
      budget: { limits, cumulativeUsed, policy: "CUMULATIVE_NOT_RESET_ON_RESTART_OR_DATE", monetaryCost: null },
    },
    observations: observationFacts,
    work: {
      steps: windowSteps.map(step => ({
        id: step.id, ordinal: step.ordinal, toolName: step.toolName, status: step.status,
        at: step.finishedAt?.toISOString() ?? null, note: missionToolLabels[step.toolName] ?? null,
      })),
      stepsLimit: 5, stepsTruncated: windowSteps.length > 5,
      latestOutput: progressOutputs[0] ? { id: progressOutputs[0].id, revision: progressOutputs[0].revision, createdAt: progressOutputs[0].createdAt.toISOString() } : null,
      actionReceipts: actions.map(a => ({
        actionId: a.id, title: a.title, status: a.status, resultCardId: a.resultCardId,
        completedAt: a.completedAt?.toISOString() ?? null, isSimulated: a.isSimulated,
      })),
      actionReceiptsLimit: 5, actionReceiptsTruncated: actionIdCandidates.length > 5,
      progress: reviewProgress,
    },
    basis: {
      questionId: input.questionId ?? wait?.questionId ?? null,
      materialUses, evidenceReviews: packetEvidenceReviews, currentUsePolicy: "SOURCE_POLICY_APPLIED",
    },
    pendingOriginalRefs: {
      approvals: pendingApprovals.map(a => ({ id: a.id, proposalHash: a.proposalHash, expiresAt: a.expiresAt.toISOString(), status: a.status })),
    },
    coverage: {
      windows: [
        { name: "RECENT_STEPS", limit: 5, returned: windowSteps.length, truncated: windowSteps.length > 5 },
        { name: "ACTION_RECEIPTS", limit: 5, returned: actions.length, truncated: actionIdCandidates.length > 5 },
        { name: "MATERIAL_USES", limit: 8, returned: materialUses.items.length, truncated: materialUses.coverage.sourceLimitReached === true },
        { name: "MATERIAL_SOURCE_EVENTS", limit: 80, returned: materialUses.coverage.eventsInspected, truncated: materialUses.coverage.eventsTruncated },
        { name: "MATERIAL_MISSION_RUNS", limit: 40, returned: materialUses.coverage.runsInspected, truncated: materialUses.coverage.runsTruncated, note: "窗口先按 trace.missionId 过滤再取最近本委托的 CHAT 运行；未找到不等于从未使用。" },
        { name: "MISSION_MODEL_RUNS", limit: 20, returned: callCoverage.inspected.agentRuns, truncated: callCoverage.inspected.truncated, note: "调用覆盖窗口先按 trace.missionId 过滤；未找到回执不等于从未发生。" },
        { name: "EVIDENCE_REVIEWS", limit: 3, returned: evidenceReviews.items.length, truncated: evidenceReviews.truncated },
      ],
    },
  };
  return {
    mission: m,
    workState,
    observationFacts,
    packetBase: workPacketInput,
    readback: {
      workState, schemaVersion: 1 as const,
      missionId: id,
      projectId: m.projectId,
      missionVersion: m.version,
      missionStatus: m.status,
      /**
       * @deprecated 冻结为“本次读取时刻”，与 readAt 同值。刷新页面不会核查资料；
       * 成功观察时间只看 workState.observedAt / observation.lastSuccessfulAt。
       */
      observedAt: now.toISOString(),
      missionUpdatedAt: m.updatedAt.toISOString(),
      materialUses,
      evidenceReviews,
      reviewProgress,
      callCoverage,
      resourceUsage: missionResourceUsageOf(m.budgetUsedJson),
      sourceConversation: sourceRunId
        ? {
            sourceRunId,
            href: `/projects/${encodeURIComponent(m.projectId)}/knowledge?openCopilot=1#copilot-run-${encodeURIComponent(sourceRunId)}`,
          }
        : null,
      selected: {
        question: question
          ? {
              id: question.id,
              text:
                (question.payloadJson as { question?: string }).question ??
                "原问题",
              historical:
                question.id !== workState.exactQuestionRef || m.status !== "WAITING_INPUT" ||
                question.seq !==
                  (
                    await tx.agentMissionEvent.findFirst({
                      where: { missionId: id, type: "QUESTION" },
                      orderBy: { seq: "desc" },
                      select: { seq: true },
                    })
                  )?.seq,
            }
          : null,
        approval: approval
          ? {
              id: approval.id,
              status: approval.status,
              proposal: approval.proposalJson,
              expiresAt: approval.expiresAt.toISOString(),
            }
          : null,
        output,
        receipt: receipt
          ? {
              id: receipt.id,
              outputId: receipt.outputId,
              outputRevision: receipt.outputRevision,
              artifactId: receipt.artifactId,
            }
          : null,
      },
      adoptions: adoptions.map((r) => ({
        receiptId: r.id,
        outputId: r.outputId,
        outputRevision: r.outputRevision,
        artifactId: r.artifactId,
        artifactType: r.artifactType,
        artifactCreatedAt: r.artifact.createdAt.toISOString(),
        title: artifactTypeLabels[r.artifact.artifactType],
      })),
      actionReceipts: actions.map((a) => ({
        ...a,
        completedAt: a.completedAt?.toISOString() ?? null,
      })),
      realityOutcome: "NOT_INFERRED" as const,
    },
  };
}

/** 事务外轻量复查：只比版本字段，不重读业务事实；不一致由调用方整包重试。 */
function snapshotAdvanced(snapshot: SnapshotVersionFields, current: SnapshotVersionFields | null): boolean {
  if (!current) return true;
  return current.version !== snapshot.version || current.status !== snapshot.status
    || current.planRevision !== snapshot.planRevision || current.contextVersion !== snapshot.contextVersion
    || current.constraintsVersion !== snapshot.constraintsVersion || current.researchScopeVersion !== snapshot.researchScopeVersion
    || +current.updatedAt !== +snapshot.updatedAt;
}
/** 仅当 builder 意外失败时使用的同一事实派生摘要；读取不因此推进成功观察时间。 */
function observationOf(facts: { lastSuccessfulAt: string | null; lastFailedAt: string | null; lastNoNewInformationAt: string | null; nextCheckAt: string | null }, readAt: string): WorkPacketObservations {
  const state = facts.lastFailedAt && (!facts.lastSuccessfulAt || Date.parse(facts.lastFailedAt) >= Date.parse(facts.lastSuccessfulAt))
    ? "FAILED_LAST" as const
    : facts.lastSuccessfulAt ? "OBSERVED" as const : "NOT_OBSERVED" as const;
  return { readAt, state, lastSuccessfulAt: facts.lastSuccessfulAt, lastFailedAt: facts.lastFailedAt, lastNoNewInformationAt: facts.lastNoNewInformationAt, nextCheckAt: facts.nextCheckAt, authority: "ORIGINAL_DELEGATION_RECORDS_ONLY" };
}

/**
 * 同一委托的只读四问读回。
 *
 * 原 readback 字段与语义保持不变；新增 readAt/observation 与可选 workPacket（旧客户端忽略）。
 * 事实在同一 db.$transaction 内收集（含 responsibility 复用同一快照）；事务外只做一次版本复查：
 * - 快照未被推进 → VERSION_STABLE；
 * - 已推进且重试 <2 → 整包重读并标记 RETRIED（retries 计数）；
 * - 重试后仍推进 → 返回本次内部一致快照并标记 VERSION_ADVANCED，主操作 requires 携带全量版本，
 *   由原 command/continuation/adoption/Action 路径在提交时服务端重查（读取不签发旧操作资格）。
 */
export async function readMissionBack(
  userId: string,
  id: string,
  raw: unknown = {},
) {
  const input = readTargetSchema.parse(raw);
  let retries = 0;
  let advanced = false;
  let collected: Awaited<ReturnType<typeof collectMissionBack>>;
  let now = new Date();
  for (;;) {
    now = new Date();
    collected = await db.$transaction(tx => collectMissionBack(tx, userId, id, input, now), { timeout: 10_000 });
    const current = await db.agentMission.findUnique({ where: { id }, select: SNAPSHOT_SELECT });
    advanced = snapshotAdvanced(collected.mission, current);
    if (!advanced || retries >= 2) break;
    retries += 1;
  }
  const consistency = advanced ? "VERSION_ADVANCED" as const : retries === 0 ? "VERSION_STABLE" as const : "RETRIED" as const;
  const readAt = now.toISOString();
  let workPacket: WorkPacket | undefined;
  try {
    workPacket = buildMissionWorkPacket({ ...collected.packetBase, snapshot: { consistency, retries, checkedAt: readAt } }, now);
  } catch {
    // 旧客户端仍可退回原详情；缺失 workPacket 不等于默认成功事实。
    workPacket = undefined;
  }
  return {
    ...collected.readback,
    readAt,
    observation: workPacket?.observations ?? observationOf(collected.observationFacts, readAt),
    ...(workPacket ? { workPacket } : {}),
  };
}
export type MissionReadback = Awaited<ReturnType<typeof readMissionBack>>;
