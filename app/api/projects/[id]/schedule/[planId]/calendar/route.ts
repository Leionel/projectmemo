import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError, AppError } from "@/lib/api";
import { markCalendarRevoked, recordCalendarSync, type CalendarSyncInput } from "@/lib/services/scheduleService";

export const runtime = "nodejs";

const STATUSES = ["NONE", "PENDING", "SYNCED", "FAILED", "REVOKED"];

/**
 * 系统日历同步回执登记。客户端只上报自己在系统日历里创建/删除的结果，
 * 服务端不接受「操作用户原有日程」的语义：撤销只作用于带 eventId 的块。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; planId: string }> }) {
  try {
    const { id, planId } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    const body = (await request.json()) as {
      action?: string;
      blockIds?: string[];
      entries?: Array<{ blockId?: string; calendarId?: string | null; eventId?: string | null; status?: string; error?: string | null }>;
    };

    if (body.action === "revoke") {
      if (!Array.isArray(body.blockIds) || body.blockIds.length === 0) {
        throw new AppError("VALIDATION_ERROR", "blockIds 不能为空", 422);
      }
      const plan = await markCalendarRevoked(id, planId, body.blockIds, user.id);
      return Response.json({ plan });
    }

    if (!Array.isArray(body.entries) || body.entries.length === 0) {
      throw new AppError("VALIDATION_ERROR", "entries 不能为空", 422);
    }
    const entries: CalendarSyncInput[] = body.entries.map((entry) => {
      if (!entry.blockId || !entry.status || !STATUSES.includes(entry.status)) {
        throw new AppError("VALIDATION_ERROR", "每个条目需要 blockId 与合法的 status", 422);
      }
      return {
        blockId: entry.blockId,
        calendarId: entry.calendarId ?? null,
        eventId: entry.eventId ?? null,
        status: entry.status as CalendarSyncInput["status"],
        error: entry.error ?? null,
      };
    });
    const plan = await recordCalendarSync(id, planId, entries, user.id);
    return Response.json({ plan });
  } catch (error) {
    return apiError(error);
  }
}
