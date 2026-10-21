import { apiError } from "@/lib/api";
import { resumeMissionInputSchema } from "@/lib/xiaoyi/contracts";
import { resumeMissionFromXiaoyi } from "@/lib/xiaoyi/resumeMissionService";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return Response.json(await resumeMissionFromXiaoyi(request, resumeMissionInputSchema.parse(await request.json())), { status: 202, headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
