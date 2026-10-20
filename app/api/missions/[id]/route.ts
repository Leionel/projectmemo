import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {missionDetail} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json({mission:await missionDetail(user.id,(await c.params).id)});}catch(e){return apiError(e);}}
