import { authorizeProjectAccess } from "@/lib/auth/guard";
import { AppError, apiError } from "@/lib/api";
import {
  confirmSuggestion,
  dismissSuggestion,
  revertTopicReduction,
} from "@/lib/services/interventionFeedbackService";
import { interventionPolicyScopeForUser } from "@/lib/services/interventionPolicyService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const policyScope = interventionPolicyScopeForUser(user.id);
    const body = (await request.json()) as { action?: string; triggerType?: string };
    const triggerType = body.triggerType?.trim();
    if (!triggerType) {
      throw new AppError("INVALID_INPUT", "缺少 triggerType", 422);
    }
    if (body.action === "CONFIRM") {
      return Response.json({ policy: await confirmSuggestion(id, triggerType, policyScope), applied: true });
    }
    if (body.action === "DISMISS") {
      return Response.json({ policy: await dismissSuggestion(id, triggerType), applied: true });
    }
    if (body.action === "REVERT") {
      return Response.json({ policy: await revertTopicReduction(id, triggerType, policyScope), applied: true });
    }
    throw new AppError("INVALID_INPUT", "action 必须是 CONFIRM、DISMISS 或 REVERT", 422);
  } catch (error) {
    return apiError(error);
  }
}
