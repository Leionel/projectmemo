import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmContinuation } from "@/lib/mission/continuationService";
export const runtime="nodejs";
export async function POST(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json(await confirmContinuation(user.id,(await c.params).id,await request.json()));}catch(e){return apiError(e);}}
