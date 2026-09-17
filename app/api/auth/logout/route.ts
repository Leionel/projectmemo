import { apiError } from "@/lib/api";
import { readBearerToken } from "@/lib/auth/guard";
import { revokeSession } from "@/lib/auth/session";
import { clearedSessionCookieHeader } from "@/lib/auth/sessionCookie";

export const runtime = "nodejs";

// 清除用的 Cookie 必须带上与写入时相同的属性（含生产环境 Secure），
// 否则浏览器可能保留旧的那一份而不是真正覆盖。
const logoutHeaders = {
  "cache-control": "no-store",
  "set-cookie": clearedSessionCookieHeader(),
};

export async function POST(request: Request) {
  try {
    const token = readBearerToken(request);
    if (token) {
      const revoked = await revokeSession(token);
      if (!revoked) {
        return Response.json(
          {
            success: false,
            localSessionCleared: true,
            serverSessionRevoked: false,
            message: "本地登录状态已清除，但服务端会话撤销失败；请稍后重试或等待会话过期。",
          },
          { status: 503, headers: logoutHeaders },
        );
      }
    }
    return Response.json(
      {
        success: true,
        localSessionCleared: true,
        serverSessionRevoked: Boolean(token),
        message: token ? "已安全退出登录" : "本地登录状态已清除",
      },
      {
        status: 200,
        headers: logoutHeaders,
      },
    );
  } catch (error) {
    return apiError(error);
  }
}
