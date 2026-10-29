import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { acknowledgeMissionAttention } from "@/lib/mission/attentionReceipt";
export const runtime="nodejs";
export async function PATCH(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json(await acknowledgeMissionAttention(user.id,(await c.params).id,await request.json()));}catch(error){return apiError(error);}}
