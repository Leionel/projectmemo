import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { grantRepositoryCiAccess } from "@/lib/sensing/repoCiGrant";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; connectionId: string }> }) {
  try { const { id, connectionId } = await context.params, { user } = await authorizeProjectAccess(request, id);
    return Response.json(await grantRepositoryCiAccess(user.id, id, connectionId, await request.json()));
  } catch (error) { return apiError(error); }
}
