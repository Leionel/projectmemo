import {authenticateUser} from "@/lib/auth/guard";
import {apiError} from "@/lib/api";
import {editContinuationPolicy} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function PATCH(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json({mission:await editContinuationPolicy(user.id,(await c.params).id,await request.json())});}catch(e){return apiError(e);}}
