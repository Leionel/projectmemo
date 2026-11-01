import { record, type Tx } from "@/lib/conversation/repository";
import { json } from "@/lib/mission/contracts";

/**
 * 账户级个人记忆失效扇出：与原 invalidateContinuityConsumers 同形状、同锁顺序
 * （调用方已持 User 写锁），但覆盖该用户所有项目的活跃消费者——个人条目不是某个项目的局部状态。
 * 同步守卫（privacyRevision 读集断言）先挡住新派发与新发布；这里的异步展开不能替代那个保证。
 */
export async function invalidatePersonalMemoryConsumers(tx: Tx, userId: string, events: string[], now = new Date()): Promise<number> {
  let touched = 0;
  const active = await tx.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, conversation: { ownerUserId: userId } } });
  for (const t of active) {
    const m = record(t.readManifestJson);
    // 未携带个人记忆读集的旧在途轮次不重排：它们没有引用任何个人条目，账户策略变化也不追溯。
    if (!m.personalMemoryReadSet) continue;
    const coord = record(m.coordination);
    if (typeof coord.generation !== "number") continue;
    await tx.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: json({ ...m, coordination: { ...coord,
      state: "INVALIDATED", invalidatedAt: now.toISOString(), drainDeadline: new Date(+now + 25000).toISOString(),
      pendingEvents: [...(coord.pendingEvents as string[] ?? []), ...events].slice(-64) } }) } });
    touched++;
  }
  const missions = await tx.agentMission.findMany({ where: { ownerUserId: userId, status: { notIn: ["SUCCEEDED", "FAILED", "CANCELLED"] } } });
  for (const m of missions) {
    touched++;
    const pause = ["RUNNING", "READY", "WAITING_APPROVAL"].includes(m.status);
    await tx.agentMissionApproval.updateMany({ where: { missionId: m.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMissionStep.updateMany({ where: { missionId: m.id, status: { in: ["READY", "PLANNED", "RUNNING", "WAITING_APPROVAL"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 },
      ...(pause ? { status: "PAUSED", pauseReason: "REVIEW_REQUIRED", executionSlot: null, leaseOwner: null, leaseUntil: null, leaseEpoch: { increment: 1 } } : {}),
      planJson: json({ ...record(m.planJson), personalMemoryInvalidated: events, ...(pause ? { resumeStatus: "READY" } : {}) }) } });
  }
  return touched;
}
