import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { readMissionBack } from "@/lib/mission/readback";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { user } = await authenticateUser(request);
    const { id } = await params;
    return Response.json(
      {
        readback: await readMissionBack(
          user.id,
          id,
          Object.fromEntries(new URL(request.url).searchParams),
        ),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return apiError(e);
  }
}
