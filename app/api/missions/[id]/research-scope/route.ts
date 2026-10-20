import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {editMission} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function PATCH(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json({mission:await editMission(user.id,(await c.params).id,"research-scope",await request.json())});}catch(e){return apiError(e);}}
