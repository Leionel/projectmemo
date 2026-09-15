import { apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { getDecisionTimeline } from "@/lib/services/temporalLedgerService";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const cards = await db.knowledgeCard.findMany({
      where: { projectId: id, archivedAt: { not: null } },
      orderBy: { archivedAt: "desc" },
      select: { id: true, title: true, summary: true, type: true, archivedAt: true, createdAt: true },
    });
    const timeline = await getDecisionTimeline(id);
    const temporalById = new Map(timeline.items.map((item) => [item.card.id, item]));
    return Response.json({
      cards: cards.map((card) => ({
        id: card.id,
        title: card.title,
        summary: card.summary,
        type: card.type,
        archivedAt: card.archivedAt ? card.archivedAt.toISOString() : null,
        createdAt: card.createdAt.toISOString(),
        temporalState: temporalById.get(card.id)?.topLevelState ?? "UNKNOWN",
        reasonCode: temporalById.get(card.id)?.reasonCode ?? "NO_SUPPORTING_EVIDENCE",
        displayReason: temporalById.get(card.id)?.displayReason ?? "尚无足够的时态关系证据，当前结论保持未知。",
        historyUrl: `/api/projects/${id}/cards/${card.id}/lifecycle`,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
