import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { json, jsonHash } from "@/lib/mission/contracts";
import { createMissionInTx } from "@/lib/mission/missionService";
import { event, assertOwner } from "@/lib/mission/repository";
import { getProjectAgentContext } from "@/lib/services/projectAgentContextService";
import {
  assertActor,
  assertCopilotSources,
  manifestSchema,
  writeTransaction,
  type CopilotActor,
  type SourceManifest,
} from "./confirmation";
import {
  continuationPreviewInput,
  continuationConfirmInput,
  continuationSuggestionSchema,
  type CopilotContinuationSuggestion,
  type CopilotMissionPreview,
  type CopilotMissionReceipt,
} from "@/lib/types/copilotContinuation";
import type { Prisma } from "@/lib/generated/prisma/client";
const key = "mission-continuation";
export function isExplicitProjectTask(question: string) {
  if (/(不要|别|暂不|禁止)(新建|建立|创建|启动|转为)?(长期)?委托|(?:请)?不要(?:再)?(?:帮我)?(?:整理|准备|生成|推进|调研)/.test(question)) return false;
  const directive = /(请|帮我|委托|交给|持续跟进|开始整理|继续委托)/.test(
    question,
  );
  return (
    directive &&
    /(整理|准备|生成|完成|推进|跟进|调研|委托|交给)/.test(question) &&
    /(汇报|周报|报告|材料|调研|方案|实验|答辩|readme|项目|委托)/i.test(question)
  );
}
export async function continuationSuggestion(
  projectId: string,
  question: string,
  actor?: CopilotActor,
): Promise<CopilotContinuationSuggestion | undefined> {
  if (!actor || !isFeatureEnabled("COPILOT_CONTINUATION_ENABLED", true))
    return undefined;
  const base: CopilotContinuationSuggestion = {
    schemaVersion: 1,
    kind: "ANSWER_ONLY",
    projectId,
    sourceRunId: "",
    reason: "本次保留为项目问答，不创建委托。",
    goal: question.slice(0, 2000),
    mission: null,
  };
  if (
    !isExplicitProjectTask(question) ||
    !isFeatureEnabled("MISSION_ENABLED", false) ||
    !isFeatureEnabled("MISSION_UI_ENABLED", true)
  )
    return base;
  const owner = await db.projectMembership.findUnique({
    where: { userId_projectId: { userId: actor.userId, projectId } },
  });
  if (owner?.role !== "OWNER") return base;
  const context = await getProjectAgentContext(actor.userId, projectId);
  if (!context || context.freshness !== "FRESH")
    return {
      ...base,
      reason: "委托摘要暂不可用，请重新读取后再决定是否转为长期委托。",
    };
  const active = await db.agentMission.findFirst({
    where: {
      projectId,
      ownerUserId: actor.userId,
      status: { notIn: ["SUCCEEDED", "CANCELLED"] },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    select: { id: true, version: true, planRevision: true },
  });
  if (active) {
    const id =
      context.nextStep.entityRef.kind === "MISSION"
        ? context.nextStep.entityRef.id
        : active.id;
    const m = await db.agentMission.findFirstOrThrow({
      where: { id, projectId, ownerUserId: actor.userId },
      select: { id: true, version: true, planRevision: true },
    });
    const ref = context.nextStep.entityRef;
    return {
      ...base,
      kind: "OPEN_MISSION",
      reason:
        "项目已有待接续委托，请先核对是否为同一目标。步骤与补料保留在原任务中。",
      mission: {
        ...m,
        questionId: ref.id === id ? ref.questionId : null,
        approvalId: ref.id === id ? ref.approvalId : null,
        outputId: null,
        outputRevision: ref.id === id ? ref.outputRevision : null,
      },
    };
  }
  return {
    ...base,
    kind: "CREATE_MISSION",
    reason: "可以先预览一个只读委托；确认目标和独立授权后才创建。",
  };
}
export async function freezeContinuation(
  tx: Prisma.TransactionClient,
  sourceRunId: string,
  suggestion: CopilotContinuationSuggestion | undefined,
  manifest: SourceManifest,
) {
  if (suggestion?.kind !== "CREATE_MISSION") return;
  await tx.copilotToolExecution.create({
    data: {
      sourceRunId,
      proposalKey: key,
      tool: "create_mission",
      proposalJson: json({ goal: suggestion.goal }),
      proposalHash: jsonHash({ goal: suggestion.goal }),
      sourceManifestHash: jsonHash(manifest),
    },
  });
}
async function inspect(
  tx: Prisma.TransactionClient,
  projectId: string,
  runId: string,
  actor: CopilotActor,
) {
  await assertActor(tx, projectId, actor);
  await assertOwner(actor.userId, projectId, tx);
  const run = await tx.agentRun.findFirst({
      where: { id: runId, projectId, runType: "CHAT" },
    }),
    trace = run?.trace as Record<string, unknown> | null;
  if (!run || trace?.actorUserId !== actor.userId)
    throw new AppError("COPILOT_SOURCE_NOT_FOUND", "没有可接续的本人对话", 404);
  const result = run.resultJson as Record<string, unknown> | null,
    suggestion = continuationSuggestionSchema.safeParse(
      result?.continuationSuggestion,
    );
  const manifest = manifestSchema.safeParse(trace.copilotSources);
  const execution = await tx.copilotToolExecution.findUnique({
    where: {
      sourceRunId_proposalKey: { sourceRunId: runId, proposalKey: key },
    },
  });
  if (
    !suggestion.success ||
    suggestion.data.kind !== "CREATE_MISSION" ||
    !manifest.success ||
    !execution ||
    execution.tool !== "create_mission" ||
    execution.sourceManifestHash !== jsonHash(manifest.data)
  )
    throw new AppError(
      "COPILOT_CONTINUATION_UNAVAILABLE",
      "这条回答没有可新建的委托建议，请重新提问",
      409,
    );
  return { run, trace, execution, manifest: manifest.data };
}
async function validateUnconsumed(
  tx: Prisma.TransactionClient,
  projectId: string,
  state: Awaited<ReturnType<typeof inspect>>,
  actor: CopilotActor,
) {
  if (!isFeatureEnabled("COPILOT_CONTINUATION_ENABLED", true))
    throw new AppError(
      "COPILOT_CONTINUATION_DISABLED",
      "对话转委托当前未开启",
      503,
    );
  await assertCopilotSources(
    tx,
    projectId,
    state.manifest,
    actor,
    state.run.id,
  );
  const newer = await tx.agentMessage.findFirst({
    where: {
      projectId,
      ownerUserId: actor.userId,
      role: "USER",
      createdAt: { gt: state.run.createdAt },
    },
  });
  if (newer)
    throw new AppError(
      "COPILOT_CONVERSATION_CHANGED",
      "此后已有新的对话，请从最新回答重新预览，原建议不会自动执行",
      409,
    );
  const existing = await tx.agentMission.findFirst({
    where: {
      projectId,
      ownerUserId: actor.userId,
      status: { notIn: ["SUCCEEDED", "CANCELLED"] },
    },
    select: { id: true },
  });
  if (existing)
    throw new AppError(
      "COPILOT_MISSION_EXISTS",
      "项目已有待接续委托，请先查看原任务",
      409,
      { missionId: existing.id },
    );
}
export async function previewCopilotMission(
  projectId: string,
  raw: unknown,
  actor: CopilotActor,
): Promise<CopilotMissionPreview> {
  const input = continuationPreviewInput.parse(raw);
  return writeTransaction(input.sourceRunId, async (tx) => {
    const state = await inspect(tx, projectId, input.sourceRunId, actor);
    const payload = {
      schemaVersion: 1 as const,
      projectId,
      sourceRunId: input.sourceRunId,
      goal: input.goal,
      successCriteria: ["DRAFT_EXISTS"],
      llmContextApproved: input.llmContextApproved,
      readOnly: true as const,
      sourceHref: `/projects/${projectId}/knowledge?openCopilot=1#copilot-run-${input.sourceRunId}`,
    };
    const previewHash = jsonHash({
      ...payload,
      ownerUserId: actor.userId,
      sourceManifestHash: state.execution.sourceManifestHash,
    });
    if (
      state.execution.status === "COMMITTED" &&
      state.execution.proposalHash !== previewHash
    )
      throw new AppError(
        "COPILOT_CONTINUATION_CONSUMED",
        "这条建议已创建委托，请查看原任务",
        409,
      );
    if (state.execution.status !== "COMMITTED") {
      await validateUnconsumed(tx, projectId, state, actor);
      await tx.copilotToolExecution.update({
        where: { id: state.execution.id },
        data: { proposalJson: json(payload), proposalHash: previewHash },
      });
    }
    return { ...payload, previewHash };
  });
}
export async function confirmCopilotMission(
  projectId: string,
  raw: unknown,
  actor: CopilotActor,
): Promise<CopilotMissionReceipt> {
  const input = continuationConfirmInput.parse(raw);
  return writeTransaction(input.sourceRunId, async (tx) => {
    const state = await inspect(tx, projectId, input.sourceRunId, actor),
      intent = state.execution;
    if (intent.proposalHash !== input.previewHash)
      throw new AppError(
        "COPILOT_PREVIEW_CHANGED",
        "预览已变化，请重新审阅后确认",
        409,
      );
    if (intent.status === "COMMITTED") {
      const m = await tx.agentMission.findFirst({
        where: {
          id: intent.resultId ?? "",
          projectId,
          ownerUserId: actor.userId,
        },
      });
      if (!m)
        throw new AppError(
          "COPILOT_RESULT_MISSING",
          "原委托已不可用，不能重复新建",
          409,
        );
      return {
        missionId: m.id,
        projectId,
        sourceRunId: input.sourceRunId,
        receiptId: intent.id,
        alreadyCreated: true,
      };
    }
    await validateUnconsumed(tx, projectId, state, actor);
    const payload = intent.proposalJson as unknown as CopilotMissionPreview;
    if (
      !payload.goal ||
      payload.schemaVersion !== 1 ||
      payload.readOnly !== true
    )
      throw new AppError("COPILOT_PREVIEW_REQUIRED", "请先审阅委托预览", 409);
    const m = await createMissionInTx(tx, actor.userId, {
      projectId,
      requestId: `copilot-mission:${input.sourceRunId}`,
      goal: payload.goal,
      successCriteria: payload.successCriteria,
      llmContextApproved: payload.llmContextApproved,
      missionConstraints: { executionBoundary: "READ_ANALYZE" },
    });
    await event(tx, m.id, "COPILOT_HANDOFF", {
      sourceRunId: input.sourceRunId,
      sourceHref: payload.sourceHref,
      previewHash: input.previewHash,
      requestId: input.requestId,
    });
    await tx.copilotToolExecution.update({
      where: { id: intent.id },
      data: {
        status: "COMMITTED",
        confirmationHash: input.previewHash,
        resultId: m.id,
        committedAt: new Date(),
      },
    });
    return {
      missionId: m.id,
      projectId,
      sourceRunId: input.sourceRunId,
      receiptId: intent.id,
      alreadyCreated: false,
    };
  });
}
