import { db } from "@/lib/db";
import { authorizeXiaoyiMission } from "./missionAccess";
import type { InspectMissionInput } from "./contracts";

export async function inspectMissionFromXiaoyi(request: Request, input: InspectMissionInput) {
  const { mission, requestId } = await authorizeXiaoyiMission(request, input.mission_id, input.request_id);
  const last = await db.agentMissionEvent.findFirst({ where: { missionId: mission.id }, orderBy: { seq: "desc" }, select: { seq: true } });
  return {
    ok: true, request_id: requestId,
    mission: { id: mission.id, goal: mission.goal, status: mission.status, version: mission.version,
      context_version: mission.contextVersion, plan_revision: mission.planRevision, updated_at: mission.updatedAt.toISOString(), event_seq: last?.seq ?? 0 },
    // 仅提供应用导航参数；平台深链需单独真机联调，不返回可在小艺端消费的审批令牌。
    app_action: { kind: "OPEN_MISSION", project_id: mission.projectId, mission_id: mission.id },
    message: mission.status === "WAITING_APPROVAL" ? "请在忆程应用登录后审阅并批准提案" : "可在忆程应用查看完整执行历史",
  };
}
