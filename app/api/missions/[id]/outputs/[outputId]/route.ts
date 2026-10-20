import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import {readOutput} from "@/lib/mission/missionService";
export const runtime="nodejs";
export async function GET(request:Request,c:{params:Promise<{id:string;outputId:string}>}){try{const {user}=await authenticateUser(request);const {id,outputId}=await c.params;return Response.json({output:await readOutput(user.id,id,outputId)});}catch(e){return apiError(e);}}
