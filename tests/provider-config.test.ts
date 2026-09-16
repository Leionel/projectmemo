import { afterEach, describe, expect, it, vi } from "vitest";
import { chatWithLLMWithMeta } from "@/lib/agent/llmAgent";
import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_CHAT_MODEL,
  getChatProviderDefaults,
  getEmbeddingProviderConfig,
} from "@/lib/config/provider";
import { getEmbedding } from "@/lib/memory/embedding";

describe("W02 provider configuration", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    vi.unstubAllGlobals();
  });

  it("resolves the DeepSeek chat preset without requiring a persisted secret", () => {
    const config = getChatProviderDefaults({ LLM_PROVIDER: "deepseek" });

    expect(config.provider).toBe("deepseek");
    expect(config.baseUrl).toBe(DEEPSEEK_BASE_URL);
    expect(config.model).toBe(DEEPSEEK_CHAT_MODEL);
    expect(getEmbeddingProviderConfig({
      LLM_MODE: "openai-compatible",
      LLM_PROVIDER: "deepseek",
      LLM_API_KEY: "test-key",
    })).toBeNull();
  });

  it("keeps explicit non-DeepSeek OpenAI-compatible settings working", () => {
    const config = getChatProviderDefaults({
      LLM_PROVIDER: "openai-compatible",
      LLM_BASE_URL: "https://example.test/v1/",
      LLM_MODEL_NAME: "example-chat",
    });

    expect(config.provider).toBe("openai-compatible");
    expect(config.baseUrl).toBe("https://example.test/v1");
    expect(config.model).toBe("example-chat");
  });

  it("sends the DeepSeek preset through the OpenAI-compatible chat contract", async () => {
    process.env = {
      ...originalEnv,
      LLM_MODE: "openai-compatible",
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "",
      LLM_MODEL_NAME: "",
      LLM_API_KEY: "test-key",
    };
    let requestUrl = "";
    let requestBody: Record<string, unknown> | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await chatWithLLMWithMeta("ping");

    expect(requestUrl).toBe(`${DEEPSEEK_BASE_URL}/chat/completions`);
    expect(requestBody?.model).toBe(DEEPSEEK_CHAT_MODEL);
    expect(requestBody?.thinking).toEqual({ type: "disabled" });
    expect(result.provider).toBe(`llm:deepseek:${DEEPSEEK_CHAT_MODEL}`);
    expect(result.status).toBe("SUCCESS");
  });

  it("does not mistake the DeepSeek chat endpoint for an embedding provider", async () => {
    process.env = {
      ...originalEnv,
      LLM_MODE: "openai-compatible",
      LLM_PROVIDER: "deepseek",
      LLM_BASE_URL: "",
      LLM_MODEL_NAME: "",
      LLM_API_KEY: "test-key",
      EMBEDDING_BASE_URL: "",
      EMBEDDING_MODEL_NAME: "",
      EMBEDDING_API_KEY: "",
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await getEmbedding("项目记忆");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.isMock).toBe(true);
    expect(result.fallbackReason).toBe("embedding_provider_not_configured");
  });
});
