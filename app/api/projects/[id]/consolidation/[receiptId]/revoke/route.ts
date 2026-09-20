import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { revokeConsolidation } from "@/lib/services/memoryConsolidationService";

export const runtime = "nodejs";

/** 撤销归并：恢复被归档的记录，原始数据从未删除 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; receiptId: string }> }) {
  try {
    const { id, receiptId } = await params;
    await authorizeProjectAccess(request, id);
    const receipt = await revokeConsolidation(id, receiptId);
    return Response.json({ receipt });
  } catch (error) {
    return apiError(error);
  }
}
