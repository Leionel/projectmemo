import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {commandMission} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function POST(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json({mission:await commandMission(user.id,(await c.params).id,"replan",await request.json())},{status:202});}catch(e){return apiError(e);}}
