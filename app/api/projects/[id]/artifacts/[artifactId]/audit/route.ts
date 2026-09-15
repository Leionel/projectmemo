import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { getArtifactAudit } from "@/lib/services/artifactAuditService";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json(await getArtifactAudit(id, artifactId));
  } catch (error) {
    return apiError(error);
  }
}
