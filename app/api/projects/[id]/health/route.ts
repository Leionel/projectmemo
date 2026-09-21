import { authorizeProjectAccess } from "@/lib/auth/guard";
import { apiError } from "@/lib/api";
import { buildProjectHealthReport } from "@/lib/services/projectHealthService";

export const runtime = "nodejs";

/**
 * 项目体检：只读、确定性。
 *
 * 必须带上当前登录用户：个人提醒、个人设备日历状态与私人排程只按该用户过滤，
 * 否则成员之间会互相看到对方的日历权限、失败原因和私人时段。
 * 该接口不产生业务写入、不创建行动、也不生成检查点；子检查失败时其余结果照常返回。
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user } = await authorizeProjectAccess(request, id);
    return Response.json({ report: await buildProjectHealthReport(id, { userId: user.id }) });
  } catch (error) {
    return apiError(error);
  }
}
