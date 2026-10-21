import { apiError } from "@/lib/api";
import { inspectMissionInputSchema } from "@/lib/xiaoyi/contracts";
import { inspectMissionFromXiaoyi } from "@/lib/xiaoyi/inspectMissionService";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    return Response.json(await inspectMissionFromXiaoyi(request, inspectMissionInputSchema.parse(await request.json())), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
