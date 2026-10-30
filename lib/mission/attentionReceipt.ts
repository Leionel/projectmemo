import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { event, lock, ownedMission, commandReplay } from "./repository";
import { json, jsonHash } from "./contracts";
const schema = z.object({
  requestId: z.string().min(1).max(128),
  expectedVersion: z.number().int().positive(),
  decisionId: z.string().min(1),
  status: z.enum(["PLATFORM_ACCEPTED", "SEEN"]).default("SEEN"),
}).strict();

export async function acknowledgeMissionAttention(userId: string, id: string, raw: unknown) {
  const body = schema.parse(raw), hash = jsonHash(body);
  return db.$transaction(async tx => {
    await lock(tx, id);
    const m = await ownedMission(userId, id, tx);
    if (await commandReplay(tx, id, body.requestId, hash)) return { acknowledged: true, status: body.status };
    if (body.status === "PLATFORM_ACCEPTED") throw new AppError("PLATFORM_RECEIPT_REQUIRED", "此通道没有可核验的平台投递回执，只能标记已读", 409);
    const plan = record(m.planJson), delegation = record(plan.delegation), attention = record(delegation.attention);
    if (m.version !== body.expectedVersion || attention.decisionId !== body.decisionId) {
      throw new AppError("MISSION_CHANGED", "这条提醒已变化，请刷新", 409);
    }
    const STATUS_RANK: Record<string, number> = {
      AVAILABLE: 0,
      PLATFORM_ACCEPTED: 1,
      SEEN: 2,
    };
    const nowIso = new Date().toISOString();
    const currentDelivery = record(attention.delivery);
    const currentStatus = String(currentDelivery.status ?? "AVAILABLE");
    const targetRank = STATUS_RANK[body.status] ?? 0;
    const currentRank = STATUS_RANK[currentStatus] ?? 0;
    const effectiveStatus = targetRank >= currentRank ? body.status : currentStatus;

    const delivery = {
      ...currentDelivery,
      channel: "PRIVATE_MISSION_INBOX",
      status: effectiveStatus,
      ...(body.status === "SEEN" && !currentDelivery.seenAt ? { seenAt: nowIso } : {}),
    };
    await tx.agentMission.update({
      where: { id },
      data: {
        version: { increment: 1 },
        planJson: json({ ...plan, delegation: { ...delegation, attention: { ...attention, delivery } } }),
      },
    });
    await event(
      tx,
      id,
      "ATTENTION_SEEN",
      { decisionId: body.decisionId, requestedStatus: body.status, status: effectiveStatus, at: nowIso },
      { id: `cmd:${body.requestId}`, hash },
    );
    return { acknowledged: true, status: effectiveStatus };
  });
}
