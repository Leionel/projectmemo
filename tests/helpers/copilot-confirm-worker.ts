// Invoked only by the isolated Copilot persistence tests. No .env is loaded.
import readline from "node:readline";
import type { Prisma } from "../../lib/generated/prisma/client";

async function main() {
const [projectId, sourceRunId, encodedInput, fault = "none"] = process.argv.slice(2);
if (!process.env.DATABASE_URL?.includes("projectmemo-copilot-")) {
  throw new Error("Copilot worker requires its isolated temporary test database");
}
const { db } = await import("../../lib/db");
const { executeCopilotTool } = await import("../../lib/services/copilotService");
const input = JSON.parse(encodedInput) as Parameters<typeof executeCopilotTool>[1];
if (fault === "before-receipt") {
  const host = db as unknown as { $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number; maxWait?: number }) => Promise<T> };
  const original = host.$transaction.bind(db);
  host.$transaction = (callback, options) => original(async tx => {
    const wrapped = new Proxy(tx, {
      get(target, name) {
        if (name !== "copilotToolExecution") return Reflect.get(target, name);
        return new Proxy(target.copilotToolExecution, {
          get(delegate, method) {
            if (method !== "update") return Reflect.get(delegate, method);
            return async (args: { data?: { status?: string } }) => {
              if (args.data?.status === "COMMITTED") process.exit(19);
              return delegate.update(args as Parameters<typeof delegate.update>[0]);
            };
          },
        });
      },
    });
    return callback(wrapped);
  }, options);
}
const lines = readline.createInterface({ input: process.stdin });
process.stdout.write("READY\n");
await new Promise<void>(resolve => lines.once("line", () => resolve()));
lines.close();
try {
  const outcome = await executeCopilotTool(projectId, { ...input, sourceRunId });
  if (fault === "after-commit") process.exit(17);
  process.stdout.write(`RESULT ${JSON.stringify({ resultId: outcome.result.id, alreadyExecuted: outcome.alreadyExecuted === true })}\n`);
} catch (error) {
  process.stdout.write(`RESULT ${JSON.stringify({ error: (error as { code?: string }).code ?? "ERROR" })}\n`);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
}
void main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
