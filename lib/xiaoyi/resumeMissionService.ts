import { AppError } from "@/lib/api";
import { commandMission } from "@/lib/mission/missionService";
import { defaultBudget, usageOf } from "@/lib/mission/contracts";
import { constraintsSchema, continuationPolicySchema } from "@/lib/types/mission";
import { authorizeXiaoyiMission } from "./missionAccess";
import type { ResumeMissionInput } from "./contracts";

export async function resumeMissionFromXiaoyi(request: Request, input: ResumeMissionInput) {
  const { mission, userId, requestId } = await authorizeXiaoyiMission(request, input.mission_id, input.request_id);
  // 权限与预算必须在原 Mission 命令锁内检查，防止授权快照之后用户撤权。
  const result = await commandMission(userId, mission.id, "resume", {
    requestId: `xiaoyi-mission:${requestId}`, expectedVersion: input.expected_version,
  }, undefined, current => {
    const constraints = constraintsSchema.parse(Object.fromEntries(Object.entries(current.constraintsJson as object).filter(([key]) => key !== "llmContextApproved")));
    const consent = (current.constraintsJson as { llmContextApproved?: boolean }).llmContextApproved === true;
    const policy = continuationPolicySchema.parse(current.continuationPolicyJson);
    if (!consent || constraints.executionBoundary !== "READ_ANALYZE" || policy.mode !== "LOW_RISK_READ_ANALYZE") {
      throw new AppError("XIAOYI_MISSION_APP_REQUIRED", "请在应用中授权只读接续；行动审批必须返回应用", 409);
    }
    const budget = { ...defaultBudget, ...current.budgetJson as object }, used = usageOf(current.budgetUsedJson);
    if (Object.entries(budget).some(([key, value]) => used[key as keyof typeof used] >= value)) {
      throw new AppError("BUDGET_EXHAUSTED", "委托预算已耗尽，请返回应用查看", 409);
    }
  });
  return { ok: true, request_id: requestId, mission_id: result.id, status: result.status,
    version: result.version, accepted: true, message: "继续请求已受理，执行结果以应用内服务端回执为准" };
}
