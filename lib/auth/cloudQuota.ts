import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { json } from "@/lib/mission/contracts";

export type WorkspaceBilling = { userId: string; turnId: string; purpose: "ROUTE" | "ANSWER" };
/** Reservation and quota consumption are one durable transaction, before HTTP. */
export async function reserveWorkspaceCloudCall(billing: WorkspaceBilling): Promise<void> {
  await db.$transaction(async tx => {
    await tx.conversationTurn.updateMany({ where: { id: billing.turnId }, data: { callCount: { increment: 0 } } });
    const turn = await tx.conversationTurn.findFirst({
      where: { id: billing.turnId, conversation: { ownerUserId: billing.userId } },
    });
    if (!turn || !["OBSERVING", "GENERATING"].includes(turn.status))
      throw new AppError("TURN_CHANGED", "本次请求已结束或不可访问", 409);
    const reserved = Array.isArray(turn.reservationJson) ? turn.reservationJson as string[] : [];
    if (reserved.includes(billing.purpose) || turn.callCount >= 2)
      throw new AppError("CALL_ALREADY_RESERVED", "本次模型请求已经发出，请读取原回执", 409);
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
      callCount: { increment: 1 }, reservationJson: json([...reserved, billing.purpose]),
    } });
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
