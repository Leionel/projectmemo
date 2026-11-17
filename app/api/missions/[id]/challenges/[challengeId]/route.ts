import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { commandChallenge, readChallenge } from "@/lib/challenges/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; challengeId: string }> };
export async function GET(request: Request, context: Context) {
  try { const { user } = await authenticateUser(request), { id, challengeId } = await context.params;
    return Response.json({ session: await readChallenge(user.id, id, challengeId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try { const { user } = await authenticateUser(request), { id, challengeId } = await context.params;
    return Response.json(await commandChallenge(user.id, id, challengeId, await request.json()));
  } catch (error) { return apiError(error); }
}
