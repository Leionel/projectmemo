import { parseEvaluationOptions, runEvaluation } from "./mission-evaluation/run";
try {
  const result = await runEvaluation(parseEvaluationOptions(process.argv.slice(2), "all"));
  console.log(JSON.stringify(result, null, 2));
  if ("attempts" in result && result.attempts.some(attempt => ["FAILED", "STARTED", "ABORTED_UNKNOWN"].includes(String(attempt.status)))) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error ? error.message.match(/^([A-Z][A-Z0-9_]{2,80})(?=:|$)/)?.[1] ?? "EVALUATION_FAILED" : "EVALUATION_FAILED";
  console.error(code + ": check credentials, verified pricing, authorization and isolated records; raw provider errors are not logged");
  process.exitCode = 1;
}
