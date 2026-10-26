import { apiError, AppError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { createChangeReview, listChangeMaterials } from "@/lib/decision/changeUnderstanding";
import { readReview, reviewMission } from "@/lib/decision/reviewPersistence";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, session } = await authenticateUser(request), actor = { userId: user.id, sessionId: session.id }, id = (await context.params).id;
    await reviewMission(actor, id);
    const proposalId = new URL(request.url).searchParams.get("proposalId");
    if (proposalId) {
      const review = await readReview(actor, proposalId);
      if (review.missionId !== id) throw new AppError("REVIEW_NOT_FOUND", "复核不属于原委托", 404);
      return Response.json({ review }, { headers: { "cache-control": "private, no-store" } });
    }
    const latest = await db.decisionScenarioProposal.findFirst({ where: { missionId: id, ownerUserId: user.id, purpose: "CHANGE_REVIEW" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
    return Response.json({ ...await listChangeMaterials(actor, id), review: latest ? await readReview(actor, latest.id) : null }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, session } = await authenticateUser(request);
    return Response.json({ review: await createChangeReview({ userId: user.id, sessionId: session.id }, (await context.params).id, await request.json()) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
