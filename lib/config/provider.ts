export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_CHAT_MODEL = "deepseek-flash";
export const OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com/v1";
export const OPENAI_COMPATIBLE_CHAT_MODEL = "gpt-4o-mini";
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15000;

type Environment = Record<string, string | undefined>;

export type CompatibleProvider = "deepseek" | "openai-compatible";

export interface ChatProviderDefaults {
  provider: CompatibleProvider;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

export interface ChatProviderConfig extends ChatProviderDefaults {
  apiKey: string;
}

export interface EmbeddingProviderConfig {
  provider: CompatibleProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

function readValue(environment: Environment, name: string): string {
  return environment[name]?.trim() ?? "";
}

export function normalizeProviderBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function providerForBaseUrl(baseUrl: string, requestedProvider: string): CompatibleProvider {
  if (requestedProvider === "deepseek") {
    return "deepseek";
  }
  if (requestedProvider === "openai-compatible") {
    return "openai-compatible";
  }
  if (!baseUrl) {
    return "deepseek";
  }
  try {
    if (/(^|\.)api\.deepseek\.com$/i.test(new URL(baseUrl).hostname)) return "deepseek";
  } catch {
    // URL validation belongs to the settings boundary; an invalid value will
    // fail safely at request time and be handled by the existing fallback.
  }
  return "openai-compatible";
}

function timeoutFrom(environment: Environment, name: string, fallback: number): number {
  const parsed = Number(readValue(environment, name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolve the chat preset without reading or returning the API key.
 * DeepSeek is the default preset for this work package, while an explicit
 * base URL remains sufficient for any other OpenAI-compatible provider.
 */
export function getChatProviderDefaults(environment: Environment = process.env): ChatProviderDefaults {
  const requestedProvider = readValue(environment, "LLM_PROVIDER").toLowerCase();
  const configuredBaseUrl = normalizeProviderBaseUrl(readValue(environment, "LLM_BASE_URL"));
  const provider = providerForBaseUrl(configuredBaseUrl, requestedProvider);
  const baseUrl = configuredBaseUrl || (provider === "deepseek" ? DEEPSEEK_BASE_URL : OPENAI_COMPATIBLE_BASE_URL);
  const model = readValue(environment, "LLM_MODEL_NAME") || (provider === "deepseek" ? DEEPSEEK_CHAT_MODEL : OPENAI_COMPATIBLE_CHAT_MODEL);

  return {
    provider,
    baseUrl,
    model,
    timeoutMs: timeoutFrom(environment, "LLM_TIMEOUT_MS", DEFAULT_PROVIDER_TIMEOUT_MS),
  };
}

export function getChatProviderConfig(environment: Environment = process.env): ChatProviderConfig {
  const defaults = getChatProviderDefaults(environment);
  const apiKey = readValue(environment, "LLM_API_KEY");
  const missing = [
    apiKey ? "" : "LLM_API_KEY",
    defaults.baseUrl ? "" : "LLM_BASE_URL",
    defaults.model ? "" : "LLM_MODEL_NAME",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`LLM configuration is incomplete: missing ${missing.join(", ")}`);
  }

  return { ...defaults, apiKey };
}

/**
 * Resolve embeddings separately from chat. DeepSeek's chat preset must not be
 * treated as an embedding provider automatically: callers need to configure
 * EMBEDDING_BASE_URL and EMBEDDING_MODEL_NAME for a real embedding service.
 * Existing non-DeepSeek OpenAI-compatible setups keep the legacy shared-base
 * behavior for backwards compatibility.
 */
export function getEmbeddingProviderConfig(environment: Environment = process.env): EmbeddingProviderConfig | null {
  if (readValue(environment, "LLM_MODE") !== "openai-compatible") {
    return null;
  }

  const chat = getChatProviderDefaults(environment);
  const explicitBaseUrl = normalizeProviderBaseUrl(readValue(environment, "EMBEDDING_BASE_URL"));
  const baseUrl = explicitBaseUrl || (chat.provider === "deepseek" ? "" : chat.baseUrl);
  const apiKey = readValue(environment, "EMBEDDING_API_KEY") || readValue(environment, "LLM_API_KEY");
  const configuredModel = readValue(environment, "EMBEDDING_MODEL_NAME");
  const model = configuredModel || (chat.provider === "deepseek" ? "" : DEFAULT_EMBEDDING_MODEL);

  if (!baseUrl || !apiKey || !model) {
    return null;
  }

  return {
    provider: providerForBaseUrl(baseUrl, readValue(environment, "EMBEDDING_PROVIDER").toLowerCase()),
    baseUrl,
    model,
    apiKey,
    timeoutMs: timeoutFrom(environment, "EMBEDDING_TIMEOUT_MS", chat.timeoutMs),
  };
}
