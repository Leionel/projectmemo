import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { deleteKnowledgeCard, updateKnowledgeCard } from "@/lib/repositories/cards";
import { knowledgeCardUpdateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; cardId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id, cardId } = await context.params;
    await authorizeProjectAccess(request, id);
    const input = knowledgeCardUpdateSchema.parse(await request.json());
    return Response.json({ card: await updateKnowledgeCard(id, cardId, input) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id, cardId } = await context.params;
    await authorizeProjectAccess(request, id);
    await deleteKnowledgeCard(id, cardId);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
