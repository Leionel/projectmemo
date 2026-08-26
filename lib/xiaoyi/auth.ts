import { createHash, timingSafeEqual } from "node:crypto";
import { AppError } from "@/lib/api";

export interface XiaoyiRequestContext {
  projectId: string;
  requestId: string;
}

function constantTimeEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match?.[1]?.trim() ?? "";
}

export function authenticateXiaoyiRequest(request: Request, bodyRequestId?: string | null): XiaoyiRequestContext {
  if (process.env.XIAOYI_ADAPTER_ENABLED !== "true") {
    throw new AppError("XIAOYI_ADAPTER_DISABLED", "小艺适配层尚未启用", 503);
  }

  const configuredToken = process.env.XIAOYI_ADAPTER_TOKEN?.trim() ?? "";
  const projectId = process.env.XIAOYI_TEST_PROJECT_ID?.trim() ?? "";
  if (configuredToken.length < 32 || !projectId) {
    throw new AppError("XIAOYI_ADAPTER_NOT_CONFIGURED", "小艺适配层配置不完整", 503);
  }

  const presentedToken = readBearerToken(request);
  if (!presentedToken || !constantTimeEqual(presentedToken, configuredToken)) {
    throw new AppError("XIAOYI_UNAUTHENTICATED", "小艺调用身份验证失败", 401);
  }

  const requestId = request.headers.get("idempotency-key")?.trim() || bodyRequestId?.trim() || "";
  if (!requestId) {
    throw new AppError("XIAOYI_REQUEST_ID_REQUIRED", "调用必须提供稳定的 request_id", 400);
  }
  if (requestId.length > 128) {
    throw new AppError("XIAOYI_REQUEST_ID_INVALID", "request_id 不能超过 128 个字符", 400);
  }

  return { projectId, requestId };
}
