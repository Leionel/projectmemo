import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readMissionResponsibility, reviseMissionResponsibility } from "@/lib/mission/responsibility";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    return Response.json({ responsibility: await readMissionResponsibility(user.id, (await context.params).id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await authenticateUser(request);
    const body = await request.json();
    const responsibility = await reviseMissionResponsibility(user.id, (await context.params).id, body);
    return Response.json({ responsibility });
  } catch (error) {
    return apiError(error);
  }
}
