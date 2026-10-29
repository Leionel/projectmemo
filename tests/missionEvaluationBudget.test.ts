import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EvaluationBudget, evaluationPrice } from "../scripts/mission-evaluation/budget";
import { parseEvaluationOptions, runEvaluation } from "../scripts/mission-evaluation/run";

const config = { provider: "deepseek" as const, baseUrl: "https://api.deepseek.com", model: "deepseek-flash", timeoutMs: 1000, apiKey: "TEST_NOT_A_REAL_KEY" };
const directories: string[] = [];
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
async function fixture(maxRequests = 60, maxCostCny = 10) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pm-budget-")); directories.push(directory);
  const file = path.join(directory, "ledger.json");
  return { file, budget: await EvaluationBudget.acquire(file, config, { live: false, maxRequests, maxCostCny }) };
}
const request = () => ({ method: "POST", body: JSON.stringify({ model: config.model, max_tokens: 1000, thinking: { type: "disabled" }, messages: [{ role: "user", content: "fixture" }] }) });
const response = (usage: unknown = { prompt_tokens: 100, completion_tokens: 10 }) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop" }], usage }));

describe("P0-A isolated evaluation authorization and cumulative budget", () => {
  it("dry-run does not call fetch or initialize a database", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const result = await runEvaluation(parseEvaluationOptions([], "all"));
    expect(result.mode).toBe("DRY_RUN"); expect(fetch).not.toHaveBeenCalled(); fetch.mockRestore();
  });
  it("rejects unapproved live, mixed modes, unknown args and >3 repeats", () => {
    for (const args of [["--live"], ["--live", "--fixture", "--confirm-cost"], ["--wrong"], ["--repeats", "4"]])
      expect(() => parseEvaluationOptions(args, "all")).toThrow();
  });
  it("rejects unverified providers and models rather than guessing prices", () => {
    expect(() => evaluationPrice({ ...config, baseUrl: "https://other.invalid" })).toThrow("PRICE_NOT_VERIFIED");
    expect(() => evaluationPrice({ ...config, model: "unknown" })).toThrow("PRICE_NOT_VERIFIED");
  });
  it("cannot exceed the explicit 60 request / 10 CNY authorization", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pm-auth-")); directories.push(directory);
    for (const limits of [{ maxRequests: 61, maxCostCny: 10 }, { maxRequests: 60, maxCostCny: 11 }])
      await expect(EvaluationBudget.acquire(path.join(directory, "ledger.json"), config, { live: false, ...limits })).rejects.toThrow("AUTHORIZATION_LIMIT");
  });
  it("reserves before transport, counts failed requests, and blocks the next request", async () => {
    const { file, budget } = await fixture(1);
    const transport = vi.fn(async () => { const saved = JSON.parse(await readFile(file, "utf8")); expect(saved.entries[0].status).toBe("PENDING"); throw new Error("private provider detail"); });
    const guarded = budget.wrapFetch(transport);
    await expect(guarded(config.baseUrl + "/chat/completions", request())).rejects.toThrow();
    await expect(guarded(config.baseUrl + "/chat/completions", request())).rejects.toThrow("EVALUATION_BUDGET_EXHAUSTED");
    expect(transport).toHaveBeenCalledTimes(1); expect(budget.summary().costUpperCny).toBeGreaterThan(2);
    expect(await readFile(file, "utf8")).not.toContain("private provider detail"); await budget.close();
  });
  it("keeps unknown usage as a full conservative reservation and enforces CNY limit", async () => {
    const { budget } = await fixture(60, 3);
    const guarded = budget.wrapFetch(vi.fn(async () => response(null)));
    await guarded(config.baseUrl + "/chat/completions", request());
    expect(budget.summary().unknownUsageRequests).toBe(1);
    await expect(guarded(config.baseUrl + "/chat/completions", request())).rejects.toThrow("EVALUATION_BUDGET_EXHAUSTED");
    await budget.close();
  });
  it("known usage settles to a conservative cost; no secret or prompt content is stored", async () => {
    const { file, budget } = await fixture();
    await budget.wrapFetch(vi.fn(async () => response()))(config.baseUrl + "/chat/completions", request());
    expect(budget.summary().unknownUsageRequests).toBe(0); expect(budget.summary().costUpperCny).toBeLessThan(0.001);
    const saved = await readFile(file, "utf8"); expect(saved).not.toContain(config.apiKey); expect(saved).not.toContain('"content"'); await budget.close();
  });
  it("locks concurrent evaluators and reopening preserves consumed request limits", async () => {
    const { file, budget } = await fixture(1);
    await expect(EvaluationBudget.acquire(file, config, { live: false, maxRequests: 1, maxCostCny: 10 })).rejects.toThrow("LEDGER_LOCKED");
    await budget.wrapFetch(vi.fn(async () => response()))(config.baseUrl + "/chat/completions", request()); await budget.close();
    const reopened = await EvaluationBudget.acquire(file, config, { live: false, maxRequests: 1, maxCostCny: 10 });
    await expect(reopened.wrapFetch(vi.fn())(config.baseUrl + "/chat/completions", request())).rejects.toThrow("EVALUATION_BUDGET_EXHAUSTED"); await reopened.close();
    await expect(EvaluationBudget.acquire(file, config, { live: false, maxRequests: 2, maxCostCny: 10 })).rejects.toThrow("LEDGER_MISMATCH");
  });
  it("blocks Search/Fetch, other models and unbounded/thinking requests before transport", async () => {
    const { budget } = await fixture(); const transport = vi.fn(); const guarded = budget.wrapFetch(transport);
    await expect(guarded("https://api.deepseek.com/v1/tools/search", request())).rejects.toThrow("NETWORK_BLOCKED");
    await expect(guarded(config.baseUrl + "/chat/completions", { ...request(), body: JSON.stringify({ model: "unknown" }) })).rejects.toThrow("INVALID_EVALUATION_REQUEST");
    expect(transport).not.toHaveBeenCalled(); expect(budget.summary().requestsStarted).toBe(0); await budget.close();
  });
  it("admits Focus output sizes, reserves their actual bound, and rejects outputs above 8192", async () => {
    const {file,budget}=await fixture(2);const transport=vi.fn(async()=>response());const guarded=budget.wrapFetch(transport);
    for(const max_tokens of [2048,8192]) await guarded(config.baseUrl+"/chat/completions",{method:"POST",body:JSON.stringify({model:config.model,max_tokens,thinking:{type:"disabled"}})});
    await expect(guarded(config.baseUrl+"/chat/completions",{method:"POST",body:JSON.stringify({model:config.model,max_tokens:8193,thinking:{type:"disabled"}})})).rejects.toThrow("INVALID_EVALUATION_REQUEST");
    const ledger=JSON.parse(await readFile(file,"utf8"));expect(ledger.entries.map((entry:{maxOutputTokens:number})=>entry.maxOutputTokens)).toEqual([2048,8192]);expect(ledger.entries[1].reservedCny).toBeGreaterThan(ledger.entries[0].reservedCny);expect(transport).toHaveBeenCalledTimes(2);await budget.close();
  });
});
