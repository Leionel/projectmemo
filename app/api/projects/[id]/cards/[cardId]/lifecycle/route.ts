import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {
  archiveCard,
  confirmCardFact,
  listLifecycleEvents,
  restoreCard,
} from "@/lib/services/memoryLifecycleService";
import { lifecycleActionSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  try {
    const { id, cardId } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ events: await listLifecycleEvents(id, cardId) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; cardId: string }> }) {
  try {
    const { id, cardId } = await params;
    await authorizeProjectAccess(request, id);
    const input = lifecycleActionSchema.parse(await request.json());
    if (input.action === "CONFIRM") {
      const event = await confirmCardFact(id, cardId, { reason: input.reason });
      return Response.json({ event, archivedAt: null });
    }
    if (input.action === "ARCHIVE") {
      const card = await archiveCard(id, cardId, { reason: input.reason });
      return Response.json({ archivedAt: card.archivedAt?.toISOString() ?? null });
    }
    const card = await restoreCard(id, cardId, { reason: input.reason });
    return Response.json({ archivedAt: card.archivedAt?.toISOString() ?? null });
  } catch (error) {
    return apiError(error);
  }
}
