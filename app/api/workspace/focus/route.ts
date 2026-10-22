import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { loadGlobalFocus } from "@/lib/server/globalFocus";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json(await loadGlobalFocus(user.id, new URL(request.url).searchParams.get("archived") === "1"), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
