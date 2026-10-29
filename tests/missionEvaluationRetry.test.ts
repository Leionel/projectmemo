import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { archiveEvaluationReport, retryCandidate, needsProtocolProbe } from "../scripts/mission-evaluation/retry";
import { parseEvaluationOptions } from "../scripts/mission-evaluation/run";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
describe("evaluation retries keep original failures and budget identity", () => {
  const attempts = [{ kind: "continuation", repeat: 1, status: "ENGINEERING_COMPLETED_PENDING_HUMAN_CONTENT_REVIEW", missionId: "passed" },
    { kind: "continuation", repeat: 2, status: "FAILED", missionId: "original-failed", inputSourceId: "capture:existing" }];
  it("normal replay skips prior attempts; explicit retry reuses the failed Mission only", () => {
    expect(retryCandidate(attempts, 2, "fix-v1", false).run).toBe(false);
    expect(retryCandidate(attempts, 1, "fix-v1", true).run).toBe(false);
    expect(retryCandidate(attempts, 2, "fix-v1", true)).toMatchObject({ run: true, previous: { missionId: "original-failed", inputSourceId: "capture:existing" } });
    expect(attempts[1].status).toBe("FAILED");
  });
  it("same source revision cannot spend again, even when the last retry failed", () => {
    const history = [...attempts, { ...attempts[1], revision: "fix-v1" }];
    expect(retryCandidate(history, 2, "fix-v1", true).run).toBe(false);
    expect(retryCandidate(history, 2, "fix-v2", true).run).toBe(true);
    expect(parseEvaluationOptions(["--fixture", "--retry-failed"], "all").retryFailed).toBe(true);
  });
  it("a new code revision probes the actual current adapter once, without inheriting the old pass", () => {
    const history = [{ kind: "protocol", status: "PASSED", revision: "baseline" }];
    expect(needsProtocolProbe(history, "fix-v1", true)).toBe(true);
    expect(needsProtocolProbe(history, "fix-v1", false)).toBe(false);
    history.push({ kind: "protocol", status: "FAILED", revision: "fix-v1" });
    expect(needsProtocolProbe(history, "fix-v1", true)).toBe(false);
  });
  it("archives exact old result bytes and source versions without replacing its ledger", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "pm-retry-")); directories.push(directory);
    const file = path.join(directory, "results.json"), budget = path.join(directory, "budget.json");
    const prior = { runId: "old-run", sourceVersions: { adapter: "before-fix" }, attempts }, raw = JSON.stringify(prior, null, 2);
    await writeFile(file, raw); await writeFile(budget, '{"requestsStarted":17,"costUpperCny":0.124676}');
    const first = await archiveEvaluationReport(file, prior), second = await archiveEvaluationReport(file, prior);
    expect(first).toEqual(second); expect(await readFile(path.join(directory, first.archive), "utf8")).toBe(raw);
    expect(await readFile(file, "utf8")).toBe(raw); expect(await readFile(budget, "utf8")).toBe('{"requestsStarted":17,"costUpperCny":0.124676}');
  });
});
