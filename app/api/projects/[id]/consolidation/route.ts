import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError, AppError } from "@/lib/api";
import { confirmConsolidation, listConsolidationProposals } from "@/lib/services/memoryConsolidationService";

export const runtime = "nodejs";

/** 建议列表只读；确认归并才写库，且始终保留原始 Capture 与关系 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ proposals: await listConsolidationProposals(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      masterCardId?: string;
      mergedCardIds?: string[];
      reason?: string;
      requestId?: string;
      similarityScore?: number;
    };
    if (!body.masterCardId || !Array.isArray(body.mergedCardIds) || !body.requestId) {
      throw new AppError("VALIDATION_ERROR", "masterCardId、mergedCardIds 和 requestId 不能为空", 422);
    }
    const receipt = await confirmConsolidation(id, {
      masterCardId: body.masterCardId,
      mergedCardIds: body.mergedCardIds,
      reason: body.reason,
      requestId: body.requestId,
      similarityScore: body.similarityScore,
    });
    return Response.json({ receipt }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
