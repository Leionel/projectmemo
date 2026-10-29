import { db } from "@/lib/db";
import { apiError } from "@/lib/api";
import { authorizeProjectAccess } from "@/lib/auth/guard";
import { readDecisionSnapshot } from "@/lib/decision/snapshot";
import { assessImpact, changedRoots } from "@/lib/decision/impact";
import { isFeatureEnabled } from "@/lib/config/features";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    if (!isFeatureEnabled("TYPED_IMPACT_ENABLED", true))
      return Response.json(
        { enabled: false },
        { headers: { "cache-control": "no-store" } },
      );
    const result = await db.$transaction(async (tx) => {
      const member = await tx.projectMembership.findUnique({
        where: { userId_projectId: { userId: user.id, projectId: id } },
      });
      const s = await readDecisionSnapshot(
        tx,
        id,
        member?.role === "OWNER" ? user.id : undefined,
      );
      const root = new URL(request.url).searchParams.get("root");
      const roots = root ? [root] : changedRoots(s);
      const jobs = await tx.projectImpactJob.count({
        where: { projectId: id, status: { in: ["PENDING", "PROCESSING"] } },
      });
      return {
        enabled: true,
        assessment: assessImpact(s, roots),
        pendingJobs: jobs,
      };
    });
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return apiError(e);
  }
}
