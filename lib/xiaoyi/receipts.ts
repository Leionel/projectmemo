import { AppError } from "@/lib/api";
import { z } from "zod";

export const XIAOYI_PROVIDER = "xiaoyi-workflow";

export function externalRequestId(tool: string, stage: string, requestId: string) {
  return `${tool}:${stage}:${requestId}`;
}

export function parseStoredResponse<T>(schema: z.ZodType<T>, value: unknown): T | null {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function safeXiaoyiError(error: unknown) {
  if (error instanceof AppError) {
    return { code: error.code, message: error.message, status: error.status, details: error.details };
  }
  return { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试", status: 500 };
}

export function throwStoredFailure(value: unknown): never {
  const stored = value as { error?: { code?: string; message?: string; status?: number } } | null;
  throw new AppError(
    stored?.error?.code ?? "XIAOYI_REQUEST_FAILED",
    stored?.error?.message ?? "该 request_id 对应的调用已经失败，请使用新的 request_id 重试",
    stored?.error?.status ?? 409,
  );
}
