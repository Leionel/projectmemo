import { AppError } from "@/lib/api";
import { db } from "@/lib/db";

export const DELIVERY_CHANNEL = "SYSTEM_NOTIFICATION" as const;
export const DELIVERY_STATUSES = [
  "SCHEDULED",
  "PUBLISHED",
  "SKIPPED_LOW_SEVERITY",
  "PERMISSION_DENIED",
  "UNSUPPORTED",
  "FAILED",
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error &&
    (error as { code?: string }).code === "P2002";
}

/**
 * 记录鸿蒙系统通知通道的发布回执。它不改变 FIRE、应用内 EXPOSED 或用户反馈，
 * 同一通知键重试只更新当前通道状态，不重复制造统计事件。
 */
export async function recordInterventionDelivery(
  projectId: string,
  interventionId: string,
  input: { channel?: string; deliveryKey: string; status: DeliveryStatus; message?: string | null },
) {
  if (input.channel !== undefined && input.channel !== DELIVERY_CHANNEL) {
    throw new AppError("INVALID_DELIVERY_CHANNEL", "不支持的通知通道", 422);
  }
  const deliveryKey = input.deliveryKey.trim().slice(0, 120);
  if (!deliveryKey) throw new AppError("INVALID_DELIVERY_KEY", "通知回执缺少 deliveryKey", 422);
  const intervention = await db.agentIntervention.findFirst({
    where: { id: interventionId, projectId },
    select: { id: true },
  });
  if (!intervention) throw new AppError("INTERVENTION_NOT_FOUND", "提醒不存在或不属于当前项目", 404);

  const message = input.message?.trim().slice(0, 240) || null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const now = new Date();
    try {
      const existing = await db.interventionDelivery.findUnique({
        where: {
          interventionId_channel_deliveryKey: {
            interventionId,
            channel: DELIVERY_CHANNEL,
            deliveryKey,
          },
        },
      });
      // 一旦系统 API 接受过发布，后续失败重试不能把已确认的发布回执降级成 FAILED。
      if (existing?.publishedAt && input.status !== "PUBLISHED") {
        return db.interventionDelivery.update({
          where: { id: existing.id },
          data: { attemptedAt: now, message },
        });
      }
      return await db.interventionDelivery.upsert({
        where: {
          interventionId_channel_deliveryKey: {
            interventionId,
            channel: DELIVERY_CHANNEL,
            deliveryKey,
          },
        },
        create: {
          projectId,
          interventionId,
          channel: DELIVERY_CHANNEL,
          deliveryKey,
          status: input.status,
          message,
          attemptedAt: now,
          publishedAt: input.status === "PUBLISHED" ? now : null,
        },
        update: {
          status: input.status,
          message,
          attemptedAt: now,
          publishedAt: input.status === "PUBLISHED" ? now : null,
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : "";
      const retryable = isUniqueConstraintError(error) || errorMessage.includes("database is locked") || errorMessage.includes("busy");
      if (!retryable || attempt === 4) throw error;
    }
  }
  throw new AppError("DELIVERY_RECEIPT_FAILED", "通知回执暂时无法保存，请稍后重试", 503);
}

export async function listInterventionDeliveries(projectId: string, interventionId: string) {
  const intervention = await db.agentIntervention.findFirst({
    where: { id: interventionId, projectId },
    select: { id: true },
  });
  if (!intervention) throw new AppError("INTERVENTION_NOT_FOUND", "提醒不存在或不属于当前项目", 404);
  const rows = await db.interventionDelivery.findMany({
    where: { projectId, interventionId },
    orderBy: { attemptedAt: "desc" },
  });
  return rows.map((row) => ({
    id: row.id,
    interventionId: row.interventionId,
    projectId: row.projectId,
    channel: row.channel,
    deliveryKey: row.deliveryKey,
    status: row.status,
    message: row.message,
    attemptedAt: row.attemptedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }));
}
