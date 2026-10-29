import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import type { ChatProviderConfig } from "../../lib/config/provider";

export const PRICE_SOURCE = "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/";
export const PRICE_VERIFIED_AT = "2026-10-23";
type Price = { inputPerMillionCny: number; outputPerMillionCny: number; maxInputTokens: number };
export function evaluationPrice(config: Pick<ChatProviderConfig, "baseUrl" | "model">): Price {
  const url = new URL(config.baseUrl);
  if (url.origin !== "https://api.deepseek.com" || url.username || url.password || url.search || url.hash)
    throw new Error("PRICE_NOT_VERIFIED: only the documented official DeepSeek endpoint is admitted");
  // Peak, cache-miss rates; never assume cache discounts, credits or off-peak prices.
  if (["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"].includes(config.model))
    return { inputPerMillionCny: 2, outputPerMillionCny: 8, maxInputTokens: 1_048_576 };
  if (config.model === "deepseek-v4-pro")
    return { inputPerMillionCny: 9, outputPerMillionCny: 27, maxInputTokens: 1_048_576 };
  throw new Error("PRICE_NOT_VERIFIED: record the actual model's official price before running");
}
type Entry = {
  id: string; scope: string; startedAt: string; finishedAt?: string;
  requestHash: string; maxOutputTokens: number; reservedCny: number;
  hasObservation: boolean; toolRoleCount: number;
  status: "PENDING" | "RESPONSE" | "NETWORK_ERROR";
  httpStatus?: number; finishReason?: string | null;
  inputTokens?: number; outputTokens?: number; usageCostUpperCny?: number;
};
type Ledger = {
  schemaVersion: 1; runId: string; mode: "REAL_MODEL" | "FIXTURE_HTTP";
  model: string; endpointOrigin: string; maxRequests: number; maxCostCny: number;
  price: Price; priceSource: string; priceVerifiedAt: string; entries: Entry[]; halted?: boolean;
};
const ceilCost = (value: number) => Math.ceil(value * 1_000_000) / 1_000_000;
const validTokens = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export class EvaluationBudget {
  private scope = "preflight";
  private writes: Promise<void> = Promise.resolve();
  private constructor(private file: string, private ledger: Ledger, private lock: Awaited<ReturnType<typeof open>>) {}
  static async acquire(file: string, config: ChatProviderConfig, options: { live: boolean; maxRequests: number; maxCostCny: number }) {
    if (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 60 ||
      !Number.isFinite(options.maxCostCny) || options.maxCostCny <= 0 || options.maxCostCny > 10)
      throw new Error("AUTHORIZATION_LIMIT: requests must be 1..60 and CNY budget >0..10");
    const price = evaluationPrice(config);
    const lock = await open(file + ".lock", "wx", 0o600).catch(() => {
      throw new Error("LEDGER_LOCKED: another evaluation or an interrupted run needs review; do not reset its budget");
    });
    try {
      let ledger: Ledger;
      try {
        ledger = JSON.parse(await readFile(file, "utf8"));
        if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries) || ledger.model !== config.model ||
          ledger.mode !== (options.live ? "REAL_MODEL" : "FIXTURE_HTTP") ||
          ledger.maxRequests !== options.maxRequests || ledger.maxCostCny !== options.maxCostCny ||
          JSON.stringify(ledger.price) !== JSON.stringify(price) || ledger.endpointOrigin !== new URL(config.baseUrl).origin ||
          ledger.entries.some(row => !Number.isFinite(row.reservedCny) || row.reservedCny <= 0 ||
            row.usageCostUpperCny !== undefined && (!Number.isFinite(row.usageCostUpperCny) || row.usageCostUpperCny < 0)) ||
          ledger.entries.length > options.maxRequests)
          throw new Error("LEDGER_MISMATCH: cannot replace or increase an existing authorization");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        ledger = { schemaVersion: 1, runId: randomUUID(), mode: options.live ? "REAL_MODEL" : "FIXTURE_HTTP",
          model: config.model, endpointOrigin: new URL(config.baseUrl).origin, maxRequests: options.maxRequests, maxCostCny: options.maxCostCny, price,
          priceSource: PRICE_SOURCE, priceVerifiedAt: PRICE_VERIFIED_AT, entries: [] };
      }
      const budget = new EvaluationBudget(file, ledger, lock);
      await budget.save();
      return budget;
    } catch (error) { await lock.close(); await unlink(file + ".lock"); throw error; }
  }
  setScope(scope: string) { this.scope = scope; }
  summary() {
    return { runId: this.ledger.runId, mode: this.ledger.mode, model: this.ledger.model,
      requestsStarted: this.ledger.entries.length, maxRequests: this.ledger.maxRequests,
      costUpperCny: ceilCost(this.ledger.entries.reduce((sum, row) => sum + (row.usageCostUpperCny ?? row.reservedCny), 0)),
      maxCostCny: this.ledger.maxCostCny, unknownUsageRequests: this.ledger.entries.filter(row => row.usageCostUpperCny === undefined).length,
      realModelRequests: this.ledger.mode === "REAL_MODEL" ? this.ledger.entries.length : 0,
      priceSource: this.ledger.priceSource, priceVerifiedAt: this.ledger.priceVerifiedAt };
  }
  entries() { return this.ledger.entries.map(row => ({ ...row })); }
  private save() {
    const pending = this.writes.then(async () => {
      await writeFile(this.file + ".next", JSON.stringify(this.ledger, null, 2) + "\n", { mode: 0o600 });
      await rename(this.file + ".next", this.file);
    });
    this.writes = pending.catch(() => {});
    return pending;
  }
  wrapFetch(original: typeof fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== this.ledger.endpointOrigin || !["/chat/completions", "/v1/chat/completions"].includes(url.pathname) || url.search || url.hash)
        throw new Error("EVALUATION_NETWORK_BLOCKED: this run permits only the selected model, no Search/Fetch or other outbound requests");
      if (init?.method !== "POST" || typeof init.body !== "string") throw new Error("INVALID_EVALUATION_REQUEST");
      const body = JSON.parse(init.body) as { model: string; max_tokens?: number; thinking?: { type?: string }; messages?: Array<{ role: string; content?: string }> };
      if (body.model !== this.ledger.model || !validTokens(body.max_tokens) || body.max_tokens < 1 || body.max_tokens > 8192 || body.thinking?.type !== "disabled")
        throw new Error("INVALID_EVALUATION_REQUEST: model/output/thinking must match the bounded price contract");
      const reservation = ceilCost(this.ledger.price.maxInputTokens * this.ledger.price.inputPerMillionCny / 1e6 + body.max_tokens * this.ledger.price.outputPerMillionCny / 1e6);
      const summary = this.summary();
      if (this.ledger.halted || summary.requestsStarted >= this.ledger.maxRequests || summary.costUpperCny + reservation > this.ledger.maxCostCny)
        throw new Error("EVALUATION_BUDGET_EXHAUSTED");
      const entry: Entry = { id: randomUUID(), scope: this.scope, startedAt: new Date().toISOString(),
        requestHash: createHash("sha256").update(init.body).digest("hex"), maxOutputTokens: body.max_tokens,
        reservedCny: reservation, hasObservation: body.messages?.some(message => message.role === "tool" || message.content?.includes('"observations":[{')) ?? false,
        toolRoleCount: body.messages?.filter(message => message.role === "tool").length ?? 0, status: "PENDING" };
      // Reserve the full documented input-context maximum, before any paid request.
      // A crash, HTTP error or missing usage retains this conservative reservation.
      this.ledger.entries.push(entry); await this.save();
      try {
        const response = await original(input, init);
        entry.status = "RESPONSE"; entry.httpStatus = response.status;
        try {
          const result = await response.clone().json();
          entry.finishReason = typeof result?.choices?.[0]?.finish_reason === "string" ? result.choices[0].finish_reason : null;
          const usage = result?.usage;
          if (validTokens(usage?.prompt_tokens) && validTokens(usage?.completion_tokens)) {
            entry.inputTokens = usage.prompt_tokens; entry.outputTokens = usage.completion_tokens;
            entry.usageCostUpperCny = ceilCost(usage.prompt_tokens * this.ledger.price.inputPerMillionCny / 1e6 + usage.completion_tokens * this.ledger.price.outputPerMillionCny / 1e6);
            if (usage.prompt_tokens > this.ledger.price.maxInputTokens || usage.completion_tokens > entry.maxOutputTokens) {
              this.ledger.halted = true;
              throw new Error("PROVIDER_USAGE_EXCEEDS_RESERVED_BOUND");
            }
          }
        } catch (error) { if ((error as Error).message === "PROVIDER_USAGE_EXCEEDS_RESERVED_BOUND") throw error; }
        entry.finishedAt = new Date().toISOString(); await this.save(); return response;
      } catch (error) {
        entry.status = "NETWORK_ERROR"; entry.finishedAt = new Date().toISOString(); await this.save(); throw error;
      }
    };
  }
  async close() { await this.save(); await this.lock.close(); await unlink(this.file + ".lock"); }
}
