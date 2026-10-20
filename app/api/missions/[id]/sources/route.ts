import {authenticateUser} from "@/lib/auth/guard";
import {apiError} from "@/lib/api";
import {listSources} from "@/lib/research/sourceRepository";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string}>}){try{const {user}=await authenticateUser(request);const {id}=await c.params;return Response.json({sources:await listSources(user.id,id)});}catch(e){return apiError(e);}}
