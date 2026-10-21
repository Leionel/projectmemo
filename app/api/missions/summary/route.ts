import {authenticateUser} from "@/lib/auth/guard";
import {apiError} from "@/lib/api";
import {missionWorkspaceSummary} from "@/lib/mission/workspaceSummary";
import {z} from "zod";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const {user} = await authenticateUser(request);
    const projectId = z.string().min(1).parse(new URL(request.url).searchParams.get("projectId"));
    return Response.json(await missionWorkspaceSummary(user.id, projectId), {headers: {"cache-control": "no-store"}});
  } catch (error) {return apiError(error);}
}
