import { db } from "@/lib/db";

/**
 * P3-A 轨迹索引：对项目内最近委托建立带结果标签的只读投影。
 * 结果层级严格区分，不混作成功样本：
 *  engineeringCompleted = 委托本身 SUCCEEDED（工程执行成功）；
 *  adoptionCount > 0    = 成果经用户确认归入项目（用户采用）；
 *  actionOutcomes       = 经批准创建的现实行动完成情况（行动完成，resultCardId 为复盘回执）；
 *  realOutcome          = 用户亲笔回执卡片存在时记 USER_ATTESTED（用户自述，非实测效果）。
 * 重试不重复计样本：步骤按 ordinal 去重（attempts 只是属性），协议错误按事件去重；
 * 提炼侧只按 missionId 计数，同一委托的重试不会再计。
 */

export type TrajectoryToolCall = { name: string; version: string; protocolSchemaVersion: number | null; status: string };
export type TrajectoryGuardrailObservation = { tool: string; reasonClass: string; repaired: boolean };
export type TrajectoryActionOutcome = { actionId: string; status: string; resultCardId: string | null };

export type TrajectoryEntry = {
  missionId: string;
  goal: string;
  status: string;
  finishedAt: Date | null;
  tools: TrajectoryToolCall[];
  successSequence: string[];
  engineeringCompleted: boolean;
  hasOutput: boolean;
  outputVerification: string | null;
  adoptionCount: number;
  actionOutcomes: TrajectoryActionOutcome[];
  realOutcome: "USER_ATTESTED" | "NOT_INFERRED";
  guardrailObservations: TrajectoryGuardrailObservation[];
  rejectedApprovals: number;
};

export type TrajectoryIndex = { projectId: string; ownerUserId: string; entries: TrajectoryEntry[]; truncated: boolean };

const MISSION_LIMIT = 20;

export async function buildTrajectoryIndex(ownerUserId: string, projectId: string): Promise<TrajectoryIndex> {
  const missions = await db.agentMission.findMany({
    where: { ownerUserId, projectId },
    orderBy: { createdAt: "desc" },
    take: MISSION_LIMIT + 1,
    select: { id: true, goal: true, status: true, finishedAt: true },
  });
  const truncated = missions.length > MISSION_LIMIT;
  const entries: TrajectoryEntry[] = [];
  for (const m of missions.slice(0, MISSION_LIMIT)) {
    const [steps, output, adoptionCount, rejectedApprovals, errorEvents] = await Promise.all([
      db.agentMissionStep.findMany({ where: { missionId: m.id }, orderBy: { ordinal: "asc" }, select: { toolName: true, toolVersion: true, status: true, protocolJson: true, resultJson: true, effectKey: true } }),
      db.agentMissionOutput.findFirst({ where: { missionId: m.id }, orderBy: { revision: "desc" }, select: { verificationStatus: true } }),
      db.missionArtifactReceipt.count({ where: { missionId: m.id } }),
      db.agentMissionApproval.count({ where: { missionId: m.id, status: "REJECTED" } }),
      db.agentMissionEvent.findMany({ where: { missionId: m.id, type: "MODEL_PROTOCOL_ERROR" }, orderBy: { seq: "asc" }, select: { payloadJson: true } }),
    ]);
    const protocolReason = errorEvents.length
      ? ((errorEvents[errorEvents.length - 1].payloadJson as { reason?: string; diagnostic?: { reason?: string }; code?: string }).reason
          ?? (errorEvents[errorEvents.length - 1].payloadJson as { diagnostic?: { reason?: string } }).diagnostic?.reason
          ?? (errorEvents[errorEvents.length - 1].payloadJson as { code?: string }).code
          ?? "MODEL_PROTOCOL_ERROR")
      : null;
    const succeededLater = (tool: string, afterIndex: number) => steps.some((s, i) => i > afterIndex && s.toolName === tool && s.status === "SUCCEEDED");
    const guardrailObservations: TrajectoryGuardrailObservation[] = steps
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.status === "FAILED")
      .map(({ s, i }) => ({
        tool: s.toolName,
        reasonClass: protocolReason ?? "TOOL_FAILURE",
        repaired: succeededLater(s.toolName, i),
      }));
    const actionOutcomes: TrajectoryActionOutcome[] = [];
    for (const s of steps) {
      const actionId = (s.resultJson as { data?: { actionId?: string } } | null)?.data?.actionId;
      if (!actionId || !s.effectKey) continue;
      const action = await db.actionItem.findFirst({ where: { id: actionId, projectId, dedupeKey: s.effectKey, isSimulated: false }, select: { status: true, resultCardId: true } });
      if (action) actionOutcomes.push({ actionId, status: action.status, resultCardId: action.resultCardId });
    }
    const ordered = steps.filter(s => s.status === "SUCCEEDED").map(s => s.toolName);
    const successSequence = ordered.filter((tool, i) => i === 0 || tool !== ordered[i - 1]);
    entries.push({
      missionId: m.id,
      goal: m.goal,
      status: m.status,
      finishedAt: m.finishedAt,
      tools: steps.map(s => ({ name: s.toolName, version: s.toolVersion, protocolSchemaVersion: (s.protocolJson as { schemaVersion?: number } | null)?.schemaVersion ?? null, status: s.status })),
      successSequence,
      engineeringCompleted: m.status === "SUCCEEDED",
      hasOutput: output !== null,
      outputVerification: output?.verificationStatus ?? null,
      adoptionCount,
      actionOutcomes,
      realOutcome: actionOutcomes.some(a => a.resultCardId) ? "USER_ATTESTED" : "NOT_INFERRED",
      guardrailObservations,
      rejectedApprovals,
    });
  }
  return { projectId, ownerUserId, entries, truncated };
}
