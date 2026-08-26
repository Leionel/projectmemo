import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const probeSchema = z.object({
  llmBaseUrl: z.string().trim().max(500).optional(),
  llmApiKey: z.string().trim().max(500).optional(),
  llmModelName: z.string().trim().max(100).optional(),
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  try {
    // This endpoint accepts an arbitrary OpenAI-compatible base URL and API
    // key. Keep it development-only so a deployed server cannot become an
    // unauthenticated request proxy into private networks.
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({
        success: false,
        error: "模型连通性探针仅在本地开发模式可用。",
        latencyMs: 0,
      }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const parsed = probeSchema.safeParse(body);
    const baseUrl = (parsed.success && parsed.data.llmBaseUrl ? parsed.data.llmBaseUrl : process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const apiKey = (parsed.success && parsed.data.llmApiKey ? parsed.data.llmApiKey : process.env.LLM_API_KEY) || "";
    const model = (parsed.success && parsed.data.llmModelName ? parsed.data.llmModelName : process.env.LLM_MODEL_NAME) || "gpt-4o-mini";

    if (!apiKey) {
      return NextResponse.json({
        success: false,
        error: "缺少 API Key，请先输入 Key 进行测试。",
        latencyMs: 0,
      }, { status: 400 });
    }

    const endpoint = `${baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
        temperature: 0.1,
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return NextResponse.json({
        success: false,
        status: response.status,
        error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
        latencyMs,
      }, { status: 200 });
    }

    const data = await response.json().catch(() => ({}));
    const reply = data?.choices?.[0]?.message?.content ?? "";

    return NextResponse.json({
      success: true,
      latencyMs,
      model,
      reply: String(reply).slice(0, 100),
      message: `连通成功！模型已就绪（耗时 ${latencyMs}ms）。`,
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({
      success: false,
      error: `连通失败: ${message.slice(0, 200)}`,
      latencyMs,
    }, { status: 200 });
  }
}
