import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readChallenge, startChallenge } from "@/lib/challenges/service";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { user } = await authenticateUser(request), { id } = await context.params;
    return Response.json({ session: await readChallenge(user.id, id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { user } = await authenticateUser(request), { id } = await context.params;
    return Response.json(await startChallenge(user.id, id, await request.json()));
  } catch (error) { return apiError(error); }
}
