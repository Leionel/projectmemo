import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json } from "@/lib/mission/contracts";
import { reserveTurnTokens, stageOutputLimit, tokenReservations } from "@/lib/conversation/tokenBudget";
import type { AgentExecutionResult } from "@/lib/types";
import { investigationBudgetSchema } from "@/lib/types/agentExperience";
import type { ModelPurpose } from "@/lib/conversation/tokenBudget";

export type WorkspaceBilling = { userId: string; turnId: string; purpose: ModelPurpose; sessionId?: string; inputTokens?: number; outputTokens?: number; provider?: string;
  callId?: string; promptId?: string; promptVersion?: string; outputSchemaVersion?: number };
export type ReviewBilling = { userId: string; sessionId: string; reviewProposalId: string };
/** One actor and one durable proposal reservation; never charges every project owner. */
export async function reserveReviewCloudCall(billing: ReviewBilling): Promise<void> {
  await db.$transaction(async tx => {
    await tx.$executeRaw`UPDATE "DecisionScenarioProposal" SET "id"="id" WHERE "id"=${billing.reviewProposalId}`;
    const proposal = await tx.decisionScenarioProposal.findFirst({ where: { id: billing.reviewProposalId, ownerUserId: billing.userId, purpose: { in: ["CHANGE_REVIEW", "DYNAMIC_PLAN"] }, status: "BUILDING" } });
    if (!proposal || !await tx.authSession.findFirst({ where: { id: billing.sessionId, userId: billing.userId, revokedAt: null, expiresAt: { gt: new Date() } } }))
      throw new AppError("UNAUTHORIZED", "复核已结束或登录状态已变化", 401);
    if (!await tx.projectMembership.findFirst({ where: { projectId: proposal.projectId, userId: billing.userId, role: "OWNER" } })) throw new AppError("PROJECT_NOT_FOUND", "项目权限已变化", 404);
    if (await tx.goalQuestionPreference.findFirst({ where: { missionId: proposal.missionId, userId: billing.userId, questionId: "*", mode: "STOP" } })) throw new AppError("REVIEW_STOPPED", "该主题已停止", 409);
    const state = (proposal.reviewStateJson ?? {}) as { accountReserved?: boolean };
    if (state.accountReserved) throw new AppError("CALL_ALREADY_RESERVED", "原复核请求已发出，请读取原状态", 409);
    const account = await tx.accountSecurity.findUnique({ where: { userId: billing.userId } });
    if (account) {
      if (!account.emailVerifiedAt || account.dailyCloudLimit <= 0) throw new AppError("CLOUD_ACCESS_DISABLED", "当前账号未开通云模型额度", 403);
      const day = new Date().toISOString().slice(0, 10);
      await tx.accountCloudUsage.upsert({ where: { userId_day: { userId: billing.userId, day } }, create: { userId: billing.userId, day, used: 0 }, update: {} });
      const consumed = await tx.accountCloudUsage.updateMany({ where: { userId: billing.userId, day, used: { lt: account.dailyCloudLimit } }, data: { used: { increment: 1 } } });
      if (!consumed.count) throw new AppError("CLOUD_QUOTA_EXHAUSTED", "今日云模型调用额度已用完", 429);
    }
    await tx.decisionScenarioProposal.update({ where: { id: proposal.id }, data: { reviewStateJson: json({ ...state, accountReserved: true }) } });
  });
}
/** Reservation and quota consumption are one durable transaction, before HTTP. */
export async function reserveWorkspaceCloudCall(billing: WorkspaceBilling): Promise<void> {
  await db.$transaction(async tx => {
    await tx.conversationTurn.updateMany({ where: { id: billing.turnId }, data: { callCount: { increment: 0 } } });
    const turn = await tx.conversationTurn.findFirst({
      where: { id: billing.turnId, conversation: { ownerUserId: billing.userId } },
    });
    if (!turn || !["OBSERVING", "GENERATING"].includes(turn.status))
      throw new AppError("TURN_CHANGED", "本次请求已结束或不可访问", 409);
    if (billing.sessionId && !await tx.authSession.findFirst({ where: { id: billing.sessionId, userId: billing.userId, revokedAt: null, expiresAt: { gt: new Date() } } }))
      throw new AppError("UNAUTHORIZED", "登录状态已变化，请重新登录", 401);
    const manifest = (turn.readManifestJson ?? {}) as { experience?: { policyVersion?: string; budget?: unknown } };
    let adaptive: { callId: string; maxCalls: number; inputTokens: number; outputTokens: number } | undefined;
    if (billing.callId) {
      const budget = investigationBudgetSchema.parse(manifest.experience?.budget);
      const c = await tx.conversation.findUniqueOrThrow({ where: { id: turn.conversationId } });
      if (manifest.experience?.policyVersion !== "r4-v1" || c.activeTurnId !== turn.id)
        throw new AppError("TURN_CHANGED", "本次调查已结束", 409);
      if (Date.now() - turn.createdAt.getTime() >= budget.maxElapsedMs)
        throw new AppError("INVESTIGATION_BUDGET_EXHAUSTED", "本轮调查时间已用完，可以根据已读资料继续讨论", 409);
      adaptive = { callId: billing.callId, maxCalls: budget.maxModelCalls, inputTokens: budget.maxInputTokens, outputTokens: budget.maxOutputTokens };
    } else if (manifest.experience?.policyVersion === "r4-v1" || !["ROUTE", "ANSWER"].includes(billing.purpose)) {
      throw new AppError("INVALID_MODEL_RESERVATION", "调查调用缺少原步骤编号", 409);
    }
    const reserved = reserveTurnTokens(turn.reservationJson, billing.purpose, billing.inputTokens ?? 12000, billing.outputTokens ?? stageOutputLimit(billing.purpose), adaptive);
    Object.assign(reserved[reserved.length - 1], { provider: billing.provider, promptId: billing.promptId,
      promptVersion: billing.promptVersion, outputSchemaVersion: billing.outputSchemaVersion });
    const account = await tx.accountSecurity.findUnique({ where: { userId: billing.userId } });
    if (account) {
      if (!account.emailVerifiedAt || account.dailyCloudLimit <= 0)
        throw new AppError("CLOUD_ACCESS_DISABLED", "当前账号未开通云模型额度", 403);
      const day = new Date().toISOString().slice(0, 10);
      await tx.accountCloudUsage.upsert({ where: { userId_day: { userId: billing.userId, day } },
        create: { userId: billing.userId, day, used: 0 }, update: {} });
      const consumed = await tx.accountCloudUsage.updateMany({
        where: { userId: billing.userId, day, used: { lt: account.dailyCloudLimit } },
        data: { used: { increment: 1 } },
      });
      if (!consumed.count) throw new AppError("CLOUD_QUOTA_EXHAUSTED", "今日云模型调用额度已用完", 429);
    }
    await tx.conversationTurn.update({ where: { id: turn.id }, data: {
      callCount: { increment: 1 }, reservationJson: json(reserved),
    } });
  });
}

/** Settle once even if the client disconnected or lost authorization after HTTP; this writes usage only. */
export async function settleWorkspaceCloudCall(billing: WorkspaceBilling, result: AgentExecutionResult<string>) {
  await db.$transaction(async tx => {
    await tx.conversationTurn.updateMany({ where: { id: billing.turnId }, data: { callCount: { increment: 0 } } });
    const turn = await tx.conversationTurn.findFirstOrThrow({ where: { id: billing.turnId, conversation: { ownerUserId: billing.userId } } });
    const entries = tokenReservations(turn.reservationJson), entry = entries.find(e => billing.callId ? e.callId === billing.callId : e.purpose === billing.purpose && !e.callId);
    if (!entry || entry.state === "SETTLED") return;
    const valid = (n: number | null | undefined) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
    const usage = { inputTokens: valid(result.usage?.inputTokens), outputTokens: valid(result.usage?.outputTokens) };
    entry.state = "SETTLED"; entry.usage = usage;
    await tx.conversationTurn.update({ where: { id: turn.id }, data: { reservationJson: json(entries), usageJson: json([
      ...(Array.isArray(turn.usageJson) ? turn.usageJson : []), { purpose: billing.purpose, callId: billing.callId,
        promptId: billing.promptId, promptVersion: billing.promptVersion, outputSchemaVersion: billing.outputSchemaVersion, provider: result.provider,
        requestIdentity: result.requestIdentity, usage, usageUnknown: usage.inputTokens === null || usage.outputTokens === null,
        durationMs: result.durationMs, finishReason: result.finishReason ?? null },
    ]) } });
  });
}

/** Existing accounts retain their deployment contract; public signups have an
 * AccountSecurity row and receive zero calls until explicitly provisioned.
 * A project's paid calls charge its owners, including worker/background calls.
 * Reservations count failed provider requests too, preventing retry cost abuse.
 */
export async function reserveCloudCall(projectId?: string): Promise<void> {
  if (!projectId) return; // Existing trusted CLI/provider probes do not act for a project.
  const owners = await db.projectMembership.findMany({
    where: { projectId, role: "OWNER" },
    select: { user: { select: { security: true } } },
  });
  const accounts = owners.flatMap((owner) =>
    owner.user.security ? [owner.user.security] : [],
  );
  if (!accounts.length) return;
  const day = new Date().toISOString().slice(0, 10);
  await db.$transaction(async (tx) => {
    for (const account of accounts) {
      if (!account.emailVerifiedAt || account.dailyCloudLimit <= 0)
        throw new AppError(
          "CLOUD_ACCESS_DISABLED",
          "当前账号未开通云模型额度，可继续使用记录和规则模式",
          403,
        );
      await tx.accountCloudUsage.upsert({
        where: { userId_day: { userId: account.userId, day } },
        create: { userId: account.userId, day, used: 0 },
        update: {},
      });
      const update = await tx.accountCloudUsage.updateMany({
        where: {
          userId: account.userId,
          day,
          used: { lt: account.dailyCloudLimit },
        },
        data: { used: { increment: 1 } },
      });
      if (!update.count)
        throw new AppError(
          "CLOUD_QUOTA_EXHAUSTED",
          "今日云模型调用额度已用完，请明天再试",
          429,
        );
    }
  });
}

export async function requireLegacyConfigurationAccess(userId: string) {
  if (await db.accountSecurity.findUnique({ where: { userId } }))
    throw new AppError(
      "CONFIGURATION_FORBIDDEN",
      "公开注册账号无权修改或探测服务器模型配置",
      403,
    );
}
