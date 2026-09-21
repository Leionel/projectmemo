import { z } from "zod";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { createActionFromEpisodeSuggestion } from "@/lib/services/episodeActionService";

export const runtime = "nodejs";

const bodySchema = z.object({
  claimId: z.string().trim().min(1),
  /** 必须显式为 true：检查点只提供建议，用户确认后才创建待办 */
  confirm: z.literal(true),
  mode: z.enum(["SUGGESTION", "UNBLOCK"]).optional(),
  unblockTargetActionId: z.string().trim().min(1).optional(),
  priority: z.number().int().min(1).max(5).optional(),
  estimatedMinutes: z.number().int().positive().max(10_080).optional(),
});

/**
 * 从阶段检查点的「建议下一步」创建待办。
 * 幂等键由 revisionId + claimId 决定，重复点击只会得到同一条待办。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; episodeId: string }> },
) {
  try {
    const { id, episodeId } = await params;
    await authorizeProjectAccess(request, id);
    const input = bodySchema.parse(await request.json());
    return Response.json(
      { outcome: await createActionFromEpisodeSuggestion(id, episodeId, input) },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
