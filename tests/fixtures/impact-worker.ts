// Only used with the isolated database selected by decisionEvolution.test.ts.
import { consumeImpactJobs } from "../../lib/decision/impactJobs";
import { db } from "../../lib/db";
if (process.argv.includes("--hold")) {
  process.stdout.write("READY\n");
  await new Promise(() => setInterval(() => {}, 1000));
} else {
  await consumeImpactJobs(10);
  await db.$disconnect();
}
