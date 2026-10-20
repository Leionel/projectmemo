import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {missionEvents} from "@/lib/mission/missionService";
import {AppError} from "@/lib/api";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);const n=Number(new URL(request.url).searchParams.get("afterSeq")??0);if(!Number.isSafeInteger(n)||n<0)throw new AppError("INVALID_CURSOR","事件游标无效",422);return Response.json(await missionEvents(user.id,(await c.params).id,n));}catch(e){return apiError(e);}}
