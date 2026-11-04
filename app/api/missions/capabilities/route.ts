import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertOwner } from "@/lib/mission/repository";
import { readWorkerPresence } from "@/lib/mission/workerPresence";
import { cloudCapability } from "@/lib/auth/cloudCapability";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    await assertOwner(user.id, z.string().min(1).parse(new URL(request.url).searchParams.get("projectId")));
    const enabled = isFeatureEnabled("MISSION_ENABLED", false) && isFeatureEnabled("MISSION_UI_ENABLED", true);
    // 交代委托前让用户知道“关掉页面后会不会继续”：只给心跳/巡检与云模型资格，不暴露 release、库或配置指纹。
    const presence = readWorkerPresence(), cloud = await cloudCapability(user.id);
    return Response.json({ uxWorkStateAvailable:true,enabled, widgetEnabled: enabled && isFeatureEnabled("MISSION_WIDGET_ENABLED", false),
      background: { worker: presence.status, inspecting: presence.isActivelyInspecting, lastHeartbeatAt: presence.lastHeartbeatAt },
      cloud: { available: cloud.available, reason: cloud.reason } }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
