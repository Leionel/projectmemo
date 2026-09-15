import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { checkInProjectState } from "@/lib/services/projectStateService";
import { projectStateCheckInSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    const input = projectStateCheckInSchema.parse(await request.json());
    const result = await checkInProjectState(id, input);
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
