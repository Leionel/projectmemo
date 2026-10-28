import fs from "node:fs";
import { createHash } from "node:crypto";

export type ResearchBudget = {
  authorizationId: string; runId: string; modelLimit: number; externalLimit: number; usdLimit: number;
  calls: Array<{ id: number; episode: string; kind: "MODEL" | "EXTERNAL"; fingerprint: string;
    state: "RESERVED" | "HTTP_RECEIVED" | "UNKNOWN"; reservedUSD: number; settledUSD?: number; httpStatus?: number }>;
};
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
/** One process owns the ledger for the entire campaign, including settlement. Unknowns retain their full reservation. */
export class ResearchEvaluationBudget {
  private lock: number;
  private value: ResearchBudget;
  constructor(private file: string, runId: string) {
    this.lock = fs.openSync(file + ".lock", "wx");
    try {
      this.value = JSON.parse(fs.readFileSync(file, "utf8"));
      const l = this.value;
      if (!l.authorizationId || l.runId !== runId || !Array.isArray(l.calls) ||
        !Number.isInteger(l.modelLimit) || l.modelLimit < 0 || l.modelLimit > 336 ||
        !Number.isInteger(l.externalLimit) || l.externalLimit < 0 || l.externalLimit > 96 ||
        !Number.isFinite(l.usdLimit) || l.usdLimit <= 0 || l.usdLimit > 10 ||
        l.calls.some(c => !Number.isFinite(c.reservedUSD) || c.reservedUSD < 0 || (c.settledUSD !== undefined && (!Number.isFinite(c.settledUSD) || c.settledUSD < 0))))
        throw new Error("INVALID_AUTHORIZED_RESEARCH_BUDGET");
    } catch (e) { this.close(); throw e; }
  }
  summary() {
    return { modelUsed: this.value.calls.filter(c => c.kind === "MODEL").length,
      externalUsed: this.value.calls.filter(c => c.kind === "EXTERNAL").length,
      reservedOrSettledUSD: this.value.calls.reduce((s, c) => s + (c.settledUSD ?? c.reservedUSD), 0),
      unknown: this.value.calls.filter(c => ["RESERVED", "UNKNOWN"].includes(c.state)).length };
  }
  attempted(episode: string) { return this.value.calls.some(c => c.episode === episode); }
  reserve(episode: string, target: string, body: string) {
    const url = new URL(target);
    if (url.protocol !== "https:" || url.hostname !== "api.deepseek.com" || url.port || url.username || url.password || url.search)
      throw new Error("UNEXPECTED_EVALUATION_NETWORK_TARGET");
    const kind = /^(\/v1)?\/chat\/completions$/.test(url.pathname) ? "MODEL" : /^\/v1\/tools\/(search|fetch)$/.test(url.pathname) ? "EXTERNAL" : null;
    if (!kind) throw new Error("UNEXPECTED_EVALUATION_NETWORK_TARGET");
    let reservedUSD = 0.00075;
    if (kind === "MODEL") {
      const request = JSON.parse(body);
      if (!["deepseek-flash", "deepseek-v4-flash"].includes(request.model) || !Number.isInteger(request.max_tokens) || request.max_tokens <= 0 || request.max_tokens > 8192)
        throw new Error("UNPRICED_RESEARCH_MODEL");
      // Official 2026-10-28 peak cache-miss rate. Reserve the entire 1M context, not a guessed tokenizer count.
      reservedUSD = (1048576 * 0.3 + request.max_tokens * 1.2) / 1e6;
    }
    const fingerprint = hash(episode + "\n" + url.href + "\n" + body);
    if (this.value.calls.some(c => c.fingerprint === fingerprint)) throw new Error("RESEARCH_REQUEST_ALREADY_ATTEMPTED");
    const s = this.summary();
    if ((kind === "MODEL" ? s.modelUsed >= this.value.modelLimit : s.externalUsed >= this.value.externalLimit) || s.reservedOrSettledUSD + reservedUSD > this.value.usdLimit)
      throw new Error("AUTHORIZED_BUDGET_EXHAUSTED");
    const call: ResearchBudget["calls"][number] = { id: this.value.calls.length + 1, episode, kind, fingerprint, state: "RESERVED", reservedUSD };
    this.value.calls.push(call); this.save(); return call.id;
  }
  settle(id: number, httpStatus: number, raw: string) {
    const call = this.value.calls.find(c => c.id === id);
    if (!call || call.state !== "RESERVED") throw new Error("INVALID_RESEARCH_SETTLEMENT");
    call.httpStatus = httpStatus;
    call.state = "HTTP_RECEIVED";
    if (call.kind === "EXTERNAL") call.settledUSD = httpStatus >= 200 && httpStatus < 300 ? 0.00075 : 0;
    else {
      try {
        const usage = JSON.parse(raw).usage;
        if (Number.isSafeInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isSafeInteger(usage?.completion_tokens) && usage.completion_tokens >= 0)
          call.settledUSD = (usage.prompt_tokens * 0.3 + usage.completion_tokens * 1.2) / 1e6;
      } catch { /* No trusted usage: preserve the reservation. */ }
    }
    this.save();
  }
  unknown(id: number) {
    const call = this.value.calls.find(c => c.id === id);
    if (call?.state === "RESERVED") { call.state = "UNKNOWN"; this.save(); }
  }
  private save() { fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.value, null, 2) + "\n"); fs.renameSync(this.file + ".tmp", this.file); }
  close() { if (this.lock !== undefined) { fs.closeSync(this.lock); fs.unlinkSync(this.file + ".lock"); this.lock = undefined!; } }
}
