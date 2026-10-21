import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { ownedMission } from "@/lib/mission/repository";
import { authenticateXiaoyiRequest } from "./auth";

// 配置只绑定专用测试身份；请求体不接受 userId/projectId，Mission ID 不是凭证。
export async function authorizeXiaoyiMission(request: Request, missionId: string, requestId?: string) {
  const context = authenticateXiaoyiRequest(request, requestId);
  if (!isFeatureEnabled("XIAOYI_MISSION_ENABLED", false) || !isFeatureEnabled("MISSION_ENABLED", false)) {
    throw new AppError("XIAOYI_MISSION_DISABLED", "小艺委托入口尚未启用，请返回应用", 503);
  }
  const userId = process.env.XIAOYI_TEST_USER_ID?.trim();
  const allowed = (process.env.XIAOYI_MISSION_ALLOWLIST ?? "").split(",").map(id => id.trim()).filter(Boolean);
  if (!userId || !allowed.length) throw new AppError("XIAOYI_MISSION_NOT_CONFIGURED", "小艺委托身份尚未绑定", 503);
  if (!allowed.includes(missionId)) throw new AppError("MISSION_NOT_FOUND", "没有可访问的委托", 404);
  const mission = await ownedMission(userId, missionId);
  if (mission.projectId !== context.projectId) throw new AppError("MISSION_NOT_FOUND", "没有可访问的委托", 404);
  return { userId, mission, requestId: context.requestId };
}
