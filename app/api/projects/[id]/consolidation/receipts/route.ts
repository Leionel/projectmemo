import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listConsolidationReceipts } from "@/lib/services/memoryConsolidationService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ receipts: await listConsolidationReceipts(id) });
  } catch (error) {
    return apiError(error);
  }
}
