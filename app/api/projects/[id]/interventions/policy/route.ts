import { apiError } from "@/lib/api";
import {
  getOrCreatePolicy,
  listRecentDecisions,
  updatePolicy,
} from "@/lib/services/interventionPolicyService";
import { computeSuggestion } from "@/lib/services/interventionFeedbackService";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const policy = await getOrCreatePolicy();
    const [recentDecisions, suggestions] = await Promise.all([
      listRecentDecisions(id),
      computeSuggestion(id),
    ]);
    return Response.json({
      policy: {
        scope: policy.scope,
        timezone: policy.timezone,
        dailyBudget: policy.dailyBudget,
        quietStartMinute: policy.quietStartMinute,
        quietEndMinute: policy.quietEndMinute,
        version: policy.version,
        reducedTopics: policy.reducedTopics ?? [],
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
    await params;
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
    return Response.json({
      policy: {
        scope: policy.scope,
        timezone: policy.timezone,
        dailyBudget: policy.dailyBudget,
        quietStartMinute: policy.quietStartMinute,
        quietEndMinute: policy.quietEndMinute,
        version: policy.version,
        reducedTopics: policy.reducedTopics ?? [],
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
