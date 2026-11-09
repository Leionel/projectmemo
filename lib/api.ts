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
  const failure = error as { code?: unknown; message?: unknown } | null;
  const detail = `${String(failure?.code ?? "")} ${String(failure?.message ?? "")}`;
  if (/ENOSPC|SQLITE_FULL|database or disk is full/.test(detail)) {
    console.error("Storage is full", error);
    return NextResponse.json({ error: { code: "STORAGE_FULL", message: "服务器存储空间不足，本次内容未保存，请稍后重试" } }, { status: 507 });
  }
  if (/SQLITE_BUSY|database is locked/.test(detail)) {
    console.error("Database is busy", error);
    return NextResponse.json({ error: { code: "DATABASE_BUSY", message: "数据正在处理中，请稍后重试" } }, { status: 503 });
  }
  console.error("Unhandled API error", error);
  return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "服务暂时不可用，请稍后重试" } }, { status: 500 });
}
