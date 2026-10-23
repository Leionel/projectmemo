import { AppError, apiError } from "@/lib/api";
import { resolveClientIp } from "@/lib/auth/guard";
import { enforceAccountRateLimit } from "@/lib/auth/registration";

export async function accountRequestBody(
  request: Request,
  scope: string,
): Promise<unknown> {
  const origin = request.headers.get("origin");
  const expectedOrigin = process.env.AUTH_PUBLIC_BASE_URL
    ? new URL(process.env.AUTH_PUBLIC_BASE_URL).origin
    : new URL(request.url).origin;
  if (
    request.headers.get("sec-fetch-site") === "cross-site" ||
    (origin && origin !== expectedOrigin)
  )
    throw new AppError("INVALID_ORIGIN", "请从本站页面提交", 403);
  if (
    !request.headers
      .get("content-type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new AppError("UNSUPPORTED_CONTENT_TYPE", "请使用 JSON 提交", 415);
  await enforceAccountRateLimit(scope, resolveClientIp(request));
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("EMPTY_ACCOUNT_INPUT", "请填写提交内容", 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096)
        throw new AppError("ACCOUNT_INPUT_TOO_LARGE", "提交内容过长", 413);
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function accountError(error: unknown) {
  const response = apiError(error);
  response.headers.set("cache-control", "no-store");
  if (error instanceof AppError && error.status === 429)
    response.headers.set(
      "Retry-After",
      String((error.details as { retryAfter: number }).retryAfter),
    );
  return response;
}
