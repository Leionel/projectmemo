import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { listContinuationCandidates } from "@/lib/mission/continuationService";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);return Response.json(await listContinuationCandidates(user.id,(await c.params).id,Object.fromEntries(new URL(request.url).searchParams)),{headers:{"cache-control":"no-store"}});}catch(e){return apiError(e);}}
