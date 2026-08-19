import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public details?: unknown) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "请求内容不是有效的 JSON" } },
      { status: 400 },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "提交内容不完整或格式不正确", details: error.issues } }, { status: 422 });
  }
  if (error instanceof AppError) {
    return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, { status: error.status });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, { status: 500 });
}
