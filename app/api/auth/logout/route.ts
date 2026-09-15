import { apiError } from "@/lib/api";
import { readBearerToken } from "@/lib/auth/guard";
import { revokeSession } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const token = readBearerToken(request);
    if (token) {
      await revokeSession(token);
    }
    return Response.json(
      { success: true, message: "已安全退出登录" },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "set-cookie": "pm_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
        },
      }
    );
  } catch (error) {
    return apiError(error);
  }
}
