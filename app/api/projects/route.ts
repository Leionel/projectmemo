import { apiError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { createOwnedProject, listProjects } from "@/lib/repositories/projects";
import { AppError } from "@/lib/api";
import { randomUUID } from "node:crypto";
import { listProjectDeletions } from "@/lib/services/projectDeletionService";
import { projectCreateSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";

// Next 路由类型使用显式 Request；保留已有匿名探针的无参调用。
export function GET(): Promise<Response>;
export function GET(request: Request): Promise<Response>;
export async function GET(request?: Request) {
  try {
    const req = request ?? new Request("http://localhost/api/projects");
    const { user } = await authenticateUser(req);

    // 默认只返回在册项目；`?archived=true` 只返回已归档项目。
    // 不做「一次返回全部、由客户端过滤」：跨项目聚合（提醒 / 待办 / 记忆检索）
    // 直接消费这个列表，多传一份归档数据等于让归档项目继续打扰用户。
    const archivedParam = new URL(req.url).searchParams.get("archived");
    const archived = archivedParam === "true" ? "only" : archivedParam === "include" ? "include" : "exclude";

    const projects = await listProjects(user.id, { archived });
    return Response.json({ projects, deletions: await listProjectDeletions(user.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { user, session } = await authenticateUser(request);
    const input = projectCreateSchema.parse(await request.json());
    const header = request.headers.get("Idempotency-Key")?.trim();
    if (header && input.requestId && header !== input.requestId) throw new AppError("IDEMPOTENCY_KEY_MISMATCH", "建项请求身份不一致", 422);
    const requestId = header || input.requestId || randomUUID();
    if (requestId.length > 128) throw new AppError("INVALID_REQUEST_ID", "建项请求身份过长", 422);
    const result = await createOwnedProject(input, user.id, requestId, session.id);
    return Response.json(result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    return apiError(error);
  }
}
