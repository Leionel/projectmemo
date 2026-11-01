import { NextResponse } from "next/server";
import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { db } from "@/lib/db";

export const runtime = "nodejs";

/**
 * 个人记忆导出：只面向认证 owner；区分用户自述、候选与失效历史。
 * 已删除条目只有无正文的状态标记；本导出不能作为绕开禁止重提取边界的导入入口。
 */
export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    const claims = await db.agentClaim.findMany({ where: { ownerUserId: user.id, scopeType: "ACCOUNT", kind: { in: ["PREFERENCE", "BACKGROUND", "FOCUS"] } },
      orderBy: { updatedAt: "desc" }, take: 500 });
    const asOf = new Date().toISOString();
    const items = claims.map(claim => {
      const conditions = claim.conditionsJson as { topics?: string[]; expiresAt?: string; useScope?: { mode?: string } };
      const deleted = claim.statusProjection === "DELETED";
      return {
        id: claim.id, kind: claim.kind,
        classification: claim.statusProjection === "CANDIDATE" ? "CANDIDATE" : "USER_STATED",
        status: claim.statusProjection,
        statement: deleted ? null : claim.canonicalStatement || null,
        topics: Array.isArray(conditions.topics) ? conditions.topics : [],
        expiresAt: conditions.expiresAt ?? null,
        useScope: (conditions.useScope as { mode?: string } | undefined)?.mode ?? "ALL",
        formedAt: claim.createdAt.toISOString(), updatedAt: claim.updatedAt.toISOString(),
      };
    });
    return NextResponse.json({
      asOf, format: "projectmemo-personal-memory-v1",
      explanation: "用户自述条目按你提供的内容导出；候选（CANDIDATE）与已拒绝（REJECTED）是模型归纳的待处理理解，不代表事实；已删除条目只剩状态标记。本文件不用于导入恢复。",
      items,
    });
  } catch (error) {
    return apiError(error);
  }
}
