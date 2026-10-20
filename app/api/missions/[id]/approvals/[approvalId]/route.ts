import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {commandMission} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function POST(request:Request,c:{params:Promise<{id:string;approvalId:string}>}){try{const {user}=await authenticateUser(request);const {id,approvalId}=await c.params;return Response.json({mission:await commandMission(user.id,id,"approval",await request.json(),approvalId)},{status:202});}catch(e){return apiError(e);}}
