import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { db } from "@/lib/db";
import { readReview, reviewMission } from "@/lib/decision/reviewPersistence";
import { adoptDynamicPlan } from "@/lib/decision/boundedReview";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { user, session } = await authenticateUser(request); return Response.json({ review: await readReview({ userId: user.id, sessionId: session.id }, (await context.params).id) }, { headers: { "cache-control": "private, no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { user, session } = await authenticateUser(request); return Response.json({ receipt: await adoptDynamicPlan({ userId: user.id, sessionId: session.id }, (await context.params).id, await request.json()) }); }
  catch (error) { return apiError(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user, session } = await authenticateUser(request), actor = { userId: user.id, sessionId: session.id }, id = (await context.params).id;
    const review = await readReview(actor, id);
    await db.$transaction(async tx => {
      await reviewMission(actor, review.missionId, tx);
      await tx.decisionScenarioProposal.updateMany({ where: { id, ownerUserId: user.id, status: "READY" }, data: { status: "REJECTED" } });
    });
    return Response.json({ review: await readReview(actor, id) });
  } catch (error) { return apiError(error); }
}
