import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { recordFeedback } from "@/lib/services/interventionFeedbackService";
import { FEEDBACK_TYPES, type FeedbackType } from "@/lib/services/interventionFeedbackService";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; interventionId: string }> }) {
  try {
    const { id, interventionId } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as { feedbackType?: string; reason?: string };
    const feedbackType = body.feedbackType as FeedbackType;
    if (!FEEDBACK_TYPES.includes(feedbackType)) {
      return Response.json({ error: "INVALID_FEEDBACK_TYPE" }, { status: 422 });
    }
    const result = await recordFeedback(id, interventionId, {
      feedbackType,
      reason: body.reason,
    });
    return Response.json({
      id: result.feedback.id,
      feedbackType: result.feedback.feedbackType,
      created: result.created,
    });
  } catch (error) {
    return apiError(error);
  }
}
