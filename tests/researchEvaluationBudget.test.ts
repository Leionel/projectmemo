import { afterEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ResearchEvaluationBudget } from "../scripts/research-evaluation/budget";
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function ledger(usdLimit = 1) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "research-budget-")); dirs.push(d);
  const file = path.join(d, "ledger.json");
  fs.writeFileSync(file, JSON.stringify({ authorizationId: "synthetic", runId: "probe", modelLimit: 3, externalLimit: 2, usdLimit, calls: [] }));
  return { file, budget: new ResearchEvaluationBudget(file, "probe") };
}
const body = JSON.stringify({ model: "deepseek-flash", max_tokens: 2048, messages: [] });
test("reserve before HTTP, retain unknown across restart, forbid renamed retry", () => {
  const { file, budget } = ledger();
  const id = budget.reserve("case/arm", "https://api.deepseek.com/chat/completions", body);
  expect(JSON.parse(fs.readFileSync(file, "utf8")).calls[0].state).toBe("RESERVED");
  budget.unknown(id); const held = budget.summary().reservedOrSettledUSD; budget.close();
  const resumed = new ResearchEvaluationBudget(file, "probe");
  try {
    expect(resumed.summary().reservedOrSettledUSD).toBe(held);
    expect(() => resumed.reserve("case/arm", "https://api.deepseek.com/chat/completions", body)).toThrow("ALREADY_ATTEMPTED");
  } finally { resumed.close(); }
});
test("settles actual peak-priced usage; file lock and cost ceiling are enforced", () => {
  const { file, budget } = ledger(0.4);
  try {
    expect(() => new ResearchEvaluationBudget(file, "probe")).toThrow();
    const id = budget.reserve("a", "https://api.deepseek.com/v1/chat/completions", body);
    expect(() => budget.reserve("b", "https://api.deepseek.com/chat/completions", body)).toThrow("BUDGET_EXHAUSTED");
    budget.settle(id, 200, JSON.stringify({ usage: { prompt_tokens: 1000, completion_tokens: 100 } }));
    expect(budget.summary().reservedOrSettledUSD).toBeCloseTo(0.00042);
    budget.reserve("b", "https://api.deepseek.com/chat/completions", body);
    expect(() => budget.reserve("c", "https://attacker.invalid/chat/completions", body)).toThrow("NETWORK_TARGET");
    expect(() => budget.reserve("c", "https://api.deepseek.com/chat/completions", body.replace("deepseek-flash", "unpriced"))).toThrow("UNPRICED");
  } finally { budget.close(); }
});
test("missing usage holds reservation; standalone external cap remains separate", () => {
  const { budget } = ledger();
  try {
    const id = budget.reserve("a", "https://api.deepseek.com/chat/completions", body);
    const held = budget.summary().reservedOrSettledUSD; budget.settle(id, 503, "{}");
    expect(budget.summary().reservedOrSettledUSD).toBe(held);
    for (const e of ["a", "b"]) budget.reserve(e, "https://api.deepseek.com/v1/tools/search", "{}");
    expect(() => budget.reserve("c", "https://api.deepseek.com/v1/tools/search", "{}")).toThrow("BUDGET_EXHAUSTED");
  } finally { budget.close(); }
});
