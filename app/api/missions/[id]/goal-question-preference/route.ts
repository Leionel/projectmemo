import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { ownedMission, event } from "@/lib/mission/repository";
import { assertActor } from "@/lib/copilot/confirmation";
export const runtime = "nodejs";
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user, session } = await authenticateUser(request);
    const { id } = await params;
    await db.$transaction(async (tx) => {
      const m = await ownedMission(user.id, id, tx);
      await assertActor(tx, m.projectId, {
        userId: user.id,
        sessionId: session.id,
      });
      const removed = await tx.goalQuestionPreference.deleteMany({
        where: { userId: user.id, missionId: id },
      });
      if (removed.count)
        await event(tx, id, "GOAL_QUESTION_PREFERENCE_RESET", {});
    });
    return Response.json({ resumed: true });
  } catch (e) {
    return apiError(e);
  }
}
