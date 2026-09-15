import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatProviderDefaults } from "@/lib/config/provider";
import { authenticateUser } from "@/lib/auth/guard";

export const runtime = "nodejs";

const settingsSchema = z.object({
  llmMode: z.enum(["mock", "openai-compatible"]),
  llmBaseUrl: z.string().trim().max(500).optional().default(""),
  llmApiKey: z.string().trim().max(500).optional().default(""),
  llmModelName: z.string().trim().max(100).optional().default(""),
});

/**
 * 运行时写入只改本进程的 process.env，既不持久也不跨实例，生产部署一律拒绝。
 * 旧实现用 URL hostname 判断“本地请求”，而 Host 头由客户端决定，不能作为授权依据。
 */
function isProduction() {
  return process.env.NODE_ENV === "production";
}

async function isSignedIn(request: Request) {
  try {
    await authenticateUser(request);
    return true;
  } catch {
    return false;
  }
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function publicSettings(editable: boolean) {
  const chatDefaults = getChatProviderDefaults();
  return {
    llmMode: process.env.LLM_MODE === "openai-compatible" ? "openai-compatible" : "mock",
    llmProvider: chatDefaults.provider,
    llmBaseUrl: process.env.LLM_BASE_URL || chatDefaults.baseUrl,
    llmModelName: process.env.LLM_MODEL_NAME || chatDefaults.model,
    hasApiKey: Boolean(process.env.LLM_API_KEY),
    apiKeyMasked: process.env.LLM_API_KEY ? "••••••" : "",
    editable,
  };
}

export async function GET(request: Request) {
  // 设置入口挂在根布局上，未登录页面也会读取，因此保持可读、只收紧可写。
  const editable = !isProduction() && await isSignedIn(request);
  return NextResponse.json(publicSettings(editable));
}

export async function POST(request: Request) {
  if (isProduction()) {
    return errorResponse("SETTINGS_READ_ONLY", "生产部署不支持运行时修改模型配置，请通过环境变量设置。", 403);
  }

  if (!(await isSignedIn(request))) {
    return errorResponse("UNAUTHORIZED", "请先登录再修改模型设置。", 401);
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
      ...publicSettings(true),
      message: "大模型配置已生效并应用到运行时。",
    });
  } catch (error) {
    console.error("Failed to update runtime settings:", error);
    return errorResponse("SETTINGS_UPDATE_FAILED", "保存设置失败，请稍后重试。", 500);
  }
}
