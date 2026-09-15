import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {
  getOrCreatePolicy,
  listRecentDecisions,
  updatePolicy,
} from "@/lib/services/interventionPolicyService";
import { computeSuggestion, listProjectPreferences } from "@/lib/services/interventionFeedbackService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const policy = await getOrCreatePolicy();
    const [recentDecisions, suggestions, reducedTopics] = await Promise.all([
      listRecentDecisions(id),
      computeSuggestion(id),
      listProjectPreferences(id),
    ]);
    return Response.json({
      policy: {
        scope: policy.scope,
        timezone: policy.timezone,
        dailyBudget: policy.dailyBudget,
        quietStartMinute: policy.quietStartMinute,
        quietEndMinute: policy.quietEndMinute,
        version: policy.version,
        reducedTopics,
      },
      recentDecisions,
      suggestions,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      dailyBudget?: number;
      quietStartMinute?: number;
      quietEndMinute?: number;
      timezone?: string;
    };
    const policy = await updatePolicy({
      dailyBudget: body.dailyBudget,
      quietStartMinute: body.quietStartMinute,
      quietEndMinute: body.quietEndMinute,
      timezone: body.timezone,
    });
    const reducedTopics = await listProjectPreferences(id);
    return Response.json({
      policy: {
        scope: policy.scope,
        timezone: policy.timezone,
        dailyBudget: policy.dailyBudget,
        quietStartMinute: policy.quietStartMinute,
        quietEndMinute: policy.quietEndMinute,
        version: policy.version,
        reducedTopics,
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
