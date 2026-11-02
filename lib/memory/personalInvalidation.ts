import { record, type Tx } from "@/lib/conversation/repository";
import { json } from "@/lib/mission/contracts";

/**
 * 账户个人记忆失效扇出：与原 invalidateContinuityConsumers 同形状、同锁顺序
 * （调用方已持 User 写锁），按**依赖 readSet** 决定影响面，而不是暂停该用户的全部委托。
 *
 * 三类变更（MEMORY_AGENT_INTEGRATION §6.2）：
 * - 表达默认新增（ADD）：不暂停任何在途任务；后续组织回答时自然采用。
 * - 已影响当前判断的条目变化（UPDATE/PAUSE/RESUME/WITHDRAW/DELETE）：只重协调 readSet 中引用了
 *   该条目的会话轮次与委托——未引用它的委托不受打扰。
 * - 隐私/清空/策略变化（DELETE_ALL、策略关闭或云处理变更）：所有带个人依赖的消费者一起重协调。
 *
 * 依赖证据只来自原 Step protocolJson / Turn readManifest 的 personalMemoryReadSet；
 * 没有记录过个人依赖的任务不会被本条规则波及。
 */
export type PersonalInvalidationScope = "NONE" | "CLAIM" | "ALL_DEPENDENT";

export type PersonalInvalidationResult = {
  scope: PersonalInvalidationScope;
  turns: number;
  missions: number;
  events: string[];
};

type ReadSetLike = { items?: Array<{ claimId?: string }> } | undefined | null;

function references(readSet: ReadSetLike, claimIds: Set<string> | null): boolean {
  if (!readSet || !Array.isArray(readSet.items)) return false;
  if (claimIds === null) return readSet.items.length > 0;
  return readSet.items.some(item => typeof item.claimId === "string" && claimIds.has(item.claimId));
}

export async function invalidatePersonalMemoryConsumers(tx: Tx, userId: string, events: string[],
  options: { scope: PersonalInvalidationScope; claimIds?: string[] }, now = new Date()): Promise<PersonalInvalidationResult> {
  if (options.scope === "NONE") return { scope: "NONE", turns: 0, missions: 0, events };
  const claimIds = options.scope === "CLAIM" ? new Set(options.claimIds ?? []) : null;
  if (options.scope === "CLAIM" && (!claimIds || claimIds.size === 0))
    return { scope: "NONE", turns: 0, missions: 0, events };
  let turns = 0, missions = 0;

  const active = await tx.conversationTurn.findMany({ where: { status: { in: ["OBSERVING", "GENERATING"] }, conversation: { ownerUserId: userId } } });
  for (const t of active) {
    const m = record(t.readManifestJson);
    if (!references(m.personalMemoryReadSet as ReadSetLike, claimIds)) continue;
    const coord = record(m.coordination);
    if (typeof coord.generation !== "number") continue;
    await tx.conversationTurn.update({ where: { id: t.id }, data: { readManifestJson: json({ ...m, coordination: { ...coord,
      state: "INVALIDATED", invalidatedAt: now.toISOString(), drainDeadline: new Date(+now + 25000).toISOString(),
      pendingEvents: [...(coord.pendingEvents as string[] ?? []), ...events].slice(-64) } }) } });
    turns++;
  }

  const candidates = await tx.agentMission.findMany({ where: { ownerUserId: userId, status: { notIn: ["SUCCEEDED", "FAILED", "CANCELLED"] } } });
  for (const m of candidates) {
    // 依赖证据（两处，任一成立即依赖）：
    // 1) 委托任一步骤的 protocol readSet 引用目标条目；
    // 2) 委托的模型调用 trace.contextManifest 记录了 personalClaimIds（上下文已构建但尚无步骤时）。
    const steps = await tx.agentMissionStep.findMany({ where: { missionId: m.id }, select: { protocolJson: true } });
    const stepDependent = steps.some(step => references(record(step.protocolJson).personalMemoryReadSet as ReadSetLike, claimIds));
    const inFlightDependent = references(record(m.planJson).personalMemoryReadSet as ReadSetLike, claimIds);
    // 原回执按确切 Mission 查询，不以其他任务的最近 N 条日志作为隐私守卫窗口。
    const runs = stepDependent || inFlightDependent ? [] : await tx.$queryRaw<Array<{ trace: string }>>`
      SELECT json(trace) AS trace FROM AgentRun
      WHERE projectId = ${m.projectId} AND runType = 'CHAT' AND json_extract(trace, '$.missionId') = ${m.id}`;
    const manifestDependent = runs.some(run => {
      const ids = record(record(JSON.parse(run.trace)).contextManifest).personalClaimIds;
      if (!Array.isArray(ids)) return false;
      return claimIds === null ? ids.length > 0 : ids.some(id => typeof id === "string" && claimIds.has(id));
    });
    if (!stepDependent && !inFlightDependent && !manifestDependent) continue;
    missions++;
    const pause = ["RUNNING", "READY", "WAITING_APPROVAL"].includes(m.status);
    await tx.agentMissionApproval.updateMany({ where: { missionId: m.id, status: { in: ["PENDING", "APPROVED"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMissionStep.updateMany({ where: { missionId: m.id, status: { in: ["READY", "PLANNED", "RUNNING", "WAITING_APPROVAL"] } }, data: { status: "OBSOLETE" } });
    await tx.agentMission.update({ where: { id: m.id }, data: { version: { increment: 1 }, contextVersion: { increment: 1 }, planRevision: { increment: 1 },
      ...(pause ? { status: "PAUSED", pauseReason: "REVIEW_REQUIRED", executionSlot: null, leaseOwner: null, leaseUntil: null, leaseEpoch: { increment: 1 } } : {}),
      planJson: json({ ...record(m.planJson), personalMemoryInvalidated: events, ...(pause ? { resumeStatus: "READY" } : {}) }) } });
  }
  return { scope: options.scope, turns, missions, events };
}
