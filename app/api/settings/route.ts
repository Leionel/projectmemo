import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const settingsSchema = z.object({
  llmMode: z.enum(["mock", "openai-compatible"]),
  llmBaseUrl: z.string().trim().max(500).optional().default(""),
  llmApiKey: z.string().trim().max(500).optional().default(""),
});

function canEditRuntimeSettings(request: Request) {
  const hostname = new URL(request.url).hostname;
  const isLocalHost = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
  return process.env.NODE_ENV !== "production" && isLocalHost;
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function publicSettings(request: Request) {
  return {
    llmMode: process.env.LLM_MODE === "openai-compatible" ? "openai-compatible" : "mock",
    llmBaseUrl: process.env.LLM_BASE_URL || "",
    hasApiKey: Boolean(process.env.LLM_API_KEY),
    editable: canEditRuntimeSettings(request),
  };
}

export async function GET(request: Request) {
  return NextResponse.json(publicSettings(request));
}

export async function POST(request: Request) {
  if (!canEditRuntimeSettings(request)) {
    return errorResponse("SETTINGS_READ_ONLY", "仅允许在本机开发模式下修改运行时设置。", 403);
  }

  try {
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse("INVALID_SETTINGS", "模型设置格式不正确。", 400);
    }

    const { llmMode, llmApiKey } = parsed.data;
    const llmBaseUrl = parsed.data.llmBaseUrl.replace(/\/$/, "");

    if (llmMode === "openai-compatible") {
      try {
        new URL(llmBaseUrl);
      } catch {
        return errorResponse("INVALID_BASE_URL", "请输入有效的 OpenAI-compatible API Base URL。", 400);
      }
      if (!llmApiKey && !process.env.LLM_API_KEY) {
        return errorResponse("MISSING_API_KEY", "请输入 API Key，或先在 .env 中配置 LLM_API_KEY。", 400);
      }
    }

    // 仅作用于当前本地开发进程，密钥不落盘也绝不返回给浏览器。
    process.env.LLM_MODE = llmMode;
    process.env.LLM_BASE_URL = llmBaseUrl;
    if (llmApiKey) process.env.LLM_API_KEY = llmApiKey;

    return NextResponse.json({
      ...publicSettings(request),
      message: "已应用到当前本地运行进程；重启后请通过 .env 配置恢复。",
    });
  } catch (error) {
    console.error("Failed to update runtime settings:", error);
    return errorResponse("SETTINGS_UPDATE_FAILED", "保存设置失败，请稍后重试。", 500);
  }
}
