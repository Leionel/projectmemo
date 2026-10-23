import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type EvaluationAttempt = Record<string, unknown>;
export function needsProtocolProbe(attempts: EvaluationAttempt[], revision: string, retryFailed: boolean) {
  const previous = attempts.filter(attempt => attempt.kind === "protocol").at(-1);
  return !previous || retryFailed && previous.revision !== revision;
}
/** Repeat of a command is idempotent; failed history remains a separate immutable attempt. */
export function retryCandidate(attempts: EvaluationAttempt[], repeat: number, revision: string, retryFailed: boolean) {
  const previous = attempts.filter(attempt => attempt.kind === "continuation" && attempt.repeat === repeat).at(-1);
  if (!previous) return { run: true, previous: undefined };
  if (!retryFailed || previous.revision === revision || !["FAILED", "ABORTED_UNKNOWN"].includes(String(previous.status))) return { run: false, previous };
  return { run: true, previous };
}
export async function archiveEvaluationReport(file: string, prior: unknown) {
  const text = await readFile(file, "utf8"), hash = createHash("sha256").update(text).digest("hex");
  const destination = path.join(path.dirname(file), `results-archive-${hash}.json`);
  try { await writeFile(destination, text, { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  // Preserve the original report's source-version metadata alongside its attempts.
  return { archive: path.basename(destination), sha256: hash, runId: (prior as { runId?: string }).runId };
}
