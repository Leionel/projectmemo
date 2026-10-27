import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Shared by explicit CLI development runs. Existing authorization ledger is never initialized or reset here. */
export function evaluationBudget(ledgerFile: string, responsesFile: string, episode: () => string) {
  const read = () => JSON.parse(fs.readFileSync(ledgerFile, "utf8").replace(/^\uFEFF/, ""));
  const original = globalThis.fetch, responses: unknown[] = fs.existsSync(responsesFile) ? JSON.parse(fs.readFileSync(responsesFile, "utf8")) : [];
  if (read().limit > 48 || read().used >= read().limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
  if (path.resolve(ledgerFile) !== path.resolve("output/r4-pr5/model-budget.json")) throw new Error("Wrong campaign ledger");
  globalThis.fetch = async (url, init) => {
    const target = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (!new URL(target).pathname.endsWith("/chat/completions")) throw new Error("UNEXPECTED_EVALUATION_NETWORK_TARGET");
    const fd = fs.openSync(ledgerFile + ".lock", "wx"); let ordinal: number;
    try { const ledger = read(); if (ledger.limit > 48 || ledger.used >= ledger.limit) throw new Error("MODEL_EVALUATION_BUDGET_EXHAUSTED");
      ordinal = ++ledger.used; ledger.calls.push({ ordinal, episode: episode(), state: "RESERVED", startedAt: new Date().toISOString() }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n");
    } finally { fs.closeSync(fd); fs.unlinkSync(ledgerFile + ".lock"); }
    try {
      const response = await original(url, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(20000)]) }), raw = await response.clone().text(), responseHash = createHash("sha256").update(raw).digest("hex");
      responses.push({ ordinal, episode: episode(), httpStatus: response.status, responseHash, response: raw }); fs.writeFileSync(responsesFile, JSON.stringify(responses, null, 2) + "\n");
      const ledger = read(); Object.assign(ledger.calls.find((c: { ordinal: number }) => c.ordinal === ordinal), { state: "HTTP_RECEIVED", httpStatus: response.status, responseHash }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n"); return response;
    } catch (error) { const ledger = read(); Object.assign(ledger.calls.find((c: { ordinal: number }) => c.ordinal === ordinal), { state: "UNKNOWN" }); fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2) + "\n"); throw error; }
  };
  return { read, restore: () => { globalThis.fetch = original; } };
}
