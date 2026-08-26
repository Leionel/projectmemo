import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const settingsSchema = z.object({
  llmMode: z.enum(["mock", "openai-compatible"]),
  llmBaseUrl: z.string().trim().max(500).optional().default(""),
  llmApiKey: z.string().trim().max(500).optional().default(""),
  llmModelName: z.string().trim().max(100).optional().default(""),
});

function canEditRuntimeSettings(request: Request) {
  // 开发环境下允许本地、局域网及模拟器(10.0.2.2)配置运行时设置
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  const hostname = new URL(request.url).hostname;
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function publicSettings(request: Request) {
  return {
    llmMode: process.env.LLM_MODE === "openai-compatible" ? "openai-compatible" : "mock",
    llmBaseUrl: process.env.LLM_BASE_URL || "",
    llmModelName: process.env.LLM_MODEL_NAME || "gpt-4o-mini",
    hasApiKey: Boolean(process.env.LLM_API_KEY),
    apiKeyMasked: process.env.LLM_API_KEY ? `${process.env.LLM_API_KEY.slice(0, 4)}...${process.env.LLM_API_KEY.slice(-4)}` : "",
    editable: canEditRuntimeSettings(request),
  };
}

export async function GET(request: Request) {
  return NextResponse.json(publicSettings(request));
}

export async function POST(request: Request) {
  if (!canEditRuntimeSettings(request)) {
    return errorResponse("SETTINGS_READ_ONLY", "仅允许在开发模式下修改运行时设置。", 403);
  }

  try {
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return errorResponse("INVALID_SETTINGS", "模型设置格式不正确。", 400);
    }

    const { llmMode, llmApiKey, llmModelName } = parsed.data;
    const llmBaseUrl = parsed.data.llmBaseUrl.replace(/\/$/, "");

    if (llmMode === "openai-compatible") {
      if (llmBaseUrl) {
        try {
          new URL(llmBaseUrl);
        } catch {
          return errorResponse("INVALID_BASE_URL", "请输入有效的 OpenAI-compatible API Base URL。", 400);
        }
      }
      if (!llmApiKey && !process.env.LLM_API_KEY) {
        return errorResponse("MISSING_API_KEY", "请输入 API Key，或先在环境变量中配置 LLM_API_KEY。", 400);
      }
    }

    // 作用于当前运行进程
    process.env.LLM_MODE = llmMode;
    if (llmBaseUrl) process.env.LLM_BASE_URL = llmBaseUrl;
    if (llmApiKey) process.env.LLM_API_KEY = llmApiKey;
    if (llmModelName) process.env.LLM_MODEL_NAME = llmModelName;

    return NextResponse.json({
      ...publicSettings(request),
      message: "大模型配置已生效并应用到运行时。",
    });
  } catch (error) {
    console.error("Failed to update runtime settings:", error);
    return errorResponse("SETTINGS_UPDATE_FAILED", "保存设置失败，请稍后重试。", 500);
  }
}
