import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { buildProjectHealthReport } from "@/lib/services/projectHealthService";

export const runtime = "nodejs";

/**
 * 项目体检：只读、确定性。
 * 该接口不产生业务写入、不创建行动、也不生成检查点；子检查失败时其余结果照常返回。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await authorizeProjectAccess(request, id);
    return Response.json({ report: await buildProjectHealthReport(id) });
  } catch (error) {
    return apiError(error);
  }
}
