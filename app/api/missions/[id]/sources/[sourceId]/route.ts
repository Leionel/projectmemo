import {authenticateUser} from "@/lib/auth/guard";
import {apiError} from "@/lib/api";
import {readSource} from "@/lib/research/sourceRepository";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string;sourceId:string}>}){try{const {user}=await authenticateUser(request);const {id,sourceId}=await c.params;return Response.json({source:await readSource(user.id,id,sourceId)});}catch(e){return apiError(e);}}
