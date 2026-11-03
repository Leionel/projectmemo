import {missionWorkState} from "./workState";
import type {Prisma} from "@/lib/generated/prisma/client";
import {db} from "@/lib/db";
import {isFeatureEnabled} from "@/lib/config/features";
import {assertOwner} from "./repository";
import {missionToolLabels, type MissionTerminalUnsettledSummary, type MissionWorkspaceSummary} from "./presentation";

/** 终态窗口上限：与项目上下文候选窗口同一有界策略（按 updatedAt 倒序取最近若干条），不做全库扫描。 */
export const TERMINAL_UNSETTLED_LIMIT = 6;
const TERMINAL_STATUSES = ["SUCCEEDED", "CANCELLED"];
/** 未结算事实只有两类来源：LAST_ERROR（lastErrorJson 含 UNKNOWN）与 STEP（原 Step 状态 UNKNOWN）。 */
const TERMINAL_UNSETTLED_IDENTITY_NOTE = "条目 id/status/version 与原委托、详情与读回一致；workState 并列显示 terminal 与 unsettledEffect（requiresUser=true，仅能在原委托中核对/结算）。读取只投影既有事实：不核销 UNKNOWN、不改变终态、version、updatedAt 或生命周期。";
const TERMINAL_UNSETTLED_FAILED_NOTE = "终态未结算入口本次读取失败，未确认不存在；请从原委托列表或详情核对，不要把本次失败当作“没有未结算调用”。";
const TERMINAL_UNSETTLED_EMPTY_NOTE = "当前项目没有已结束（SUCCEEDED/CANCELLED）的终态委托；非终态 UNKNOWN 仍由原 items 的 workState 显示，不影响原摘要。";

/**
 * Bounded, read-only projection of existing records. No model, evaluation or new lifecycle.
 * 在原摘要入口追加“终态 + 未结算 UNKNOWN”窗口：不建新收件箱、不改两端 UI、不写库。
 * 覆盖必须诚实：窗口内未找到 ≠ 全库没有（更早的终态委托或非本项目的委托不在窗口内）。
 */
export async function missionWorkspaceSummary(userId: string, projectId: string): Promise<MissionWorkspaceSummary> {
  await assertOwner(userId, projectId);
  if (!isFeatureEnabled("MISSION_ENABLED", false) || !isFeatureEnabled("MISSION_UI_ENABLED", true)) {
    return {enabled: false, totalActive: 0, items: []};
  }
  const attentionStates = ["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED"];
  const where = {ownerUserId: userId, projectId, status: {notIn: ["SUCCEEDED", "CANCELLED"]}};
  const [waiting, running, totalActive, terminalUnsettled] = await Promise.all([
    db.agentMission.findMany({where: {...where, status: {in: attentionStates}}, orderBy: {updatedAt: "desc"}, take: 3, select: missionSummarySelect}),
    db.agentMission.findMany({where: {...where, status: {notIn: [...attentionStates, "SUCCEEDED", "CANCELLED"]}}, orderBy: {updatedAt: "desc"}, take: 3, select: missionSummarySelect}),
    db.agentMission.count({where}),
    readTerminalUnsettled(userId, projectId),
  ]);
  const items = [...waiting, ...running].slice(0, 3).map(m => presentMissionSummary(m));
  return {enabled: true, totalActive, items, terminalUnsettled};
}

export const missionSummarySelect = {
    id: true,planRevision:true,updatedAt:true, projectId:true, goal: true, status: true, version: true, lastErrorJson: true, waitStateJson:true, planJson:true, continuationPolicyJson:true, leaseUntil:true, nextAttemptAt:true,
    // 停止请求在途与暂停原因进入摘要投影：已请求停止不等于已经停止，摘要不能显示“可继续”。
    pauseRequestedAt:true, cancelRequestedAt:true, pauseReason:true,
    // FS-A03：额度等待事件进入同一白名单，摘要与详情/读回对 QUEUED 的解释保持一致。
    events: {where: {type: {in:["QUESTION","INVESTIGATION_NO_NEW_INFORMATION","INVESTIGATION_OBSERVATION_CHANGED","DAILY_BUDGET_WAITING"] as string[]}}, orderBy: {seq: "desc" as const}, take: 1, select: {id: true, type:true, payloadJson: true}},
    approvals: {where: {status: "PENDING"}, orderBy: {expiresAt: "asc" as const}, take: 1, select: {id: true, expiresAt:true, proposalJson: true}},
    steps: {where: {status: "SUCCEEDED"}, orderBy: {ordinal: "desc" as const}, take: 1, select: {toolName: true, finishedAt: true}},
    outputs: {orderBy: {revision: "desc" as const}, take: 1, select: {revision: true, createdAt: true}},
  } as const;

/** 终态窗口复用原摘要白名单，只补 finishedAt，使 terminal.at/atSource 与原详情/读回取同一来源。 */
const terminalSummarySelect = {...missionSummarySelect, finishedAt: true} as const;

/** 终态窗口行；只在本条摘要入口内使用，不扩大 missionSummarySelect 在其他调用方的语义。 */
type TerminalSummaryRow = Prisma.AgentMissionGetPayload<{select: typeof terminalSummarySelect}>;

/**
 * 终态 + 未结算 UNKNOWN 的有界只读窗口。
 * 查询失败只降级为本入口的空窗口 + note，不拖垮原 items/totalActive（失败也不等于“不存在”）。
 */
async function readTerminalUnsettled(userId: string, projectId: string): Promise<MissionTerminalUnsettledSummary> {
  const limit = TERMINAL_UNSETTLED_LIMIT;
  try {
    const rows: TerminalSummaryRow[] = await db.agentMission.findMany({
      where: {ownerUserId: userId, projectId, status: {in: TERMINAL_STATUSES}},
      // updatedAt 相同（同毫秒）时用 id 兜底，窗口取舍不依赖数据库返回顺序。
      orderBy: [{updatedAt: "desc"}, {id: "desc"}],
      take: limit + 1,
      select: terminalSummarySelect,
    });
    // “未结算”的两类原因：lastErrorJson 含 UNKNOWN，或原 Step 仍为 UNKNOWN。
    // Step 计数按窗口内 missionId 精确统计（与详情/读回同一定义），不把任意 Step 窗口条数当成总数。
    const unknownSteps = await missionUnknownStepCounts(rows.map(row => row.id));
    const items = rows
      .map(row => presentMissionSummary(row, {unknownSteps: unknownSteps.get(row.id) ?? 0}))
      .filter(item => !!item.workState?.terminal && item.workState.unsettledEffect?.present === true)
      .slice(0, limit);
    const inspected = rows.length;
    const truncated = inspected > limit;
    return {
      items, inspected, limit, truncated,
      note: !inspected
        ? TERMINAL_UNSETTLED_EMPTY_NOTE
        : truncated
          ? `仅检查了本项目最近 ${inspected} 条终态委托（按最后修订时间），窗口已截断：更早的终态委托未检查，窗口内未找到不等于全库没有，请从原委托列表/详情核对。`
          : `仅检查了本项目最近 ${inspected} 条终态委托（按最后修订时间）；窗口内未找到不等于全库没有（更早或非本项目的终态委托不在窗口内），请从原委托列表/详情核对。`,
      identityNote: TERMINAL_UNSETTLED_IDENTITY_NOTE,
    };
  } catch {
    return {items: [], inspected: 0, limit, truncated: false, note: TERMINAL_UNSETTLED_FAILED_NOTE, identityNote: TERMINAL_UNSETTLED_IDENTITY_NOTE};
  }
}

/** 窗口内终态/候选委托的 UNKNOWN Step 精确计数；只读、按 missionId 集合有界。 */
export async function missionUnknownStepCounts(missionIds: string[]): Promise<Map<string, number>> {
  if (!missionIds.length) return new Map();
  const rows = await db.agentMissionStep.groupBy({
    by: ["missionId"],
    where: {missionId: {in: missionIds}, status: "UNKNOWN"},
    _count: {_all: true},
  });
  return new Map(rows.map(row => [row.missionId, row._count._all]));
}

export function presentMissionSummary(
    m: Prisma.AgentMissionGetPayload<{select: typeof missionSummarySelect}>,
    options: {unknownSteps?: number} = {},
) {
    // 终态窗口行可能额外携带 finishedAt 等只读字段：只透传给 WorkState 投影，不扩对外 DTO。
    const workState=missionWorkState({...m,unknownSteps: options.unknownSteps,delegationEnabled:isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED",false)});
    const attention=workState.reasonText;
    const output = m.outputs[0], step = m.steps[0];
    const latestOutput = output && (!step?.finishedAt || output.createdAt >= step.finishedAt);
    return {id: m.id, goal: m.goal, status: m.status, version: m.version, attention, workState,
      activity: latestOutput ? `草稿修订 ${output.revision} 已保存` : step ? `${missionToolLabels[step.toolName] ?? "工具步骤"}已执行` : null,
      activityAt: latestOutput ? output.createdAt.toISOString() : step?.finishedAt?.toISOString() ?? null,
      outputRevision: output?.revision ?? null};

}
