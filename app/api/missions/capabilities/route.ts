import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertOwner } from "@/lib/mission/repository";
import { z } from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    await assertOwner(user.id, z.string().min(1).parse(new URL(request.url).searchParams.get("projectId")));
    const enabled = isFeatureEnabled("MISSION_ENABLED", false) && isFeatureEnabled("MISSION_UI_ENABLED", true);
    return Response.json({ enabled, widgetEnabled: enabled && isFeatureEnabled("MISSION_WIDGET_ENABLED", false) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
