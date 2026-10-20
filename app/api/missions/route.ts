import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { createMission,listMissions } from "@/lib/mission/missionService";
import { z } from "zod";
export const runtime="nodejs";
export async function POST(request:Request){try{const {user}=await authenticateUser(request);return Response.json({mission:await createMission(user.id,await request.json())},{status:202});}catch(e){return apiError(e);}}
export async function GET(request:Request){try{const {user}=await authenticateUser(request);const u=new URL(request.url);return Response.json(await listMissions(user.id,z.string().min(1).parse(u.searchParams.get("projectId")),u.searchParams.get("cursor")??undefined));}catch(e){return apiError(e);}}
