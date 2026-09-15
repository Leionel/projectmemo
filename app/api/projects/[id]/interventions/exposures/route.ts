import { AppError, apiError } from "@/lib/api";
import { db } from "@/lib/db";
import { recordFeedback } from "@/lib/services/interventionFeedbackService";

export const runtime = "nodejs";

/**
 * 应用内曝光批量上报。近似口径（明确记录）：提醒列表加载即计一次曝光，
 * 按 interventionId 幂等去重；系统通知发布回执走独立 deliveries 路由。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { installationId?: string; interventionIds?: string[] };
    const installationId = body.installationId?.trim();
    if (!installationId) {
      throw new AppError("INVALID_INPUT", "缺少 installationId", 422);
    }
    const ids = [...new Set((body.interventionIds ?? []).filter((value) => typeof value === "string" && value !== ""))];
    if (ids.length === 0) {
      return Response.json({ exposed: 0, duplicates: 0 });
    }
    if (ids.length > 100) {
      throw new AppError("INVALID_INPUT", "单次曝光上报不能超过 100 条", 422);
    }

    let exposed = 0;
    let duplicates = 0;
    const confirmedIds: string[] = [];
    for (const interventionId of ids) {
      const intervention = await db.agentIntervention.findFirst({
        where: { id: interventionId, projectId: id },
      });
      if (!intervention) {
        // 不属于当前项目的提醒直接忽略（不确认为已上报，客户端保留待重试）
        continue;
      }
      const result = await recordFeedback(id, interventionId, { feedbackType: "EXPOSED" });
      if (result.created) {
        exposed += 1;
      } else {
        duplicates += 1;
      }
      confirmedIds.push(interventionId);
    }
    return Response.json({ exposed, duplicates, confirmedIds, installationId });
  } catch (error) {
    return apiError(error);
  }
}
