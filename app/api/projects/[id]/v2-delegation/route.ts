import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { assertOwner } from "@/lib/mission/repository";
import { readProjectReturnItems } from "@/lib/mission/reentryBrief";
import { V2_DELEGATION_LIMITS } from "@/lib/types/v2Delegation";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    const { id } = await context.params;
    await assertOwner(user.id, id);
    const enabled = ["MISSION_ENABLED", "MISSION_V2_ENABLED", "MISSION_WORKBENCH_ENABLED"].every(key => isFeatureEnabled(key, false));
    return Response.json({
      enabled,
      canStart: enabled && isFeatureEnabled("MISSION_INVESTIGATION_DELEGATION_ENABLED", false),
      limits: V2_DELEGATION_LIMITS,
      items: enabled ? await readProjectReturnItems(user.id, id) : [],
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
