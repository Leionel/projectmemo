import { authenticateUser } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { confirmArtifactAdoption } from "@/lib/mission/artifactAdoptionService";
export const runtime="nodejs";
export async function POST(request:Request,c:{params:Promise<{id:string;outputId:string}>}){try{const {user}=await authenticateUser(request);const {id,outputId}=await c.params;return Response.json({receipt:await confirmArtifactAdoption(user.id,id,outputId,await request.json())});}catch(e){return apiError(e);}}
