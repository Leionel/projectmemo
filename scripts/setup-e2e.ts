import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { E2E_DATABASE_PATH, E2E_ENV } from "./e2e-env";

const prismaDirectory = path.resolve(process.cwd(), "prisma");
const relativeDatabasePath = path.relative(prismaDirectory, E2E_DATABASE_PATH);

if (relativeDatabasePath.startsWith("..") || path.isAbsolute(relativeDatabasePath)) {
  throw new Error(`Refusing to reset an E2E database outside prisma/: ${E2E_DATABASE_PATH}`);
}

for (const suffix of ["", "-journal", "-shm", "-wal"]) {
  fs.rmSync(`${E2E_DATABASE_PATH}${suffix}`, { force: true });
}

fs.mkdirSync(path.dirname(E2E_DATABASE_PATH), { recursive: true });
new Database(E2E_DATABASE_PATH).close();

const commandEnvironment = {
  ...process.env,
  ...E2E_ENV,
};

function run(label: string, entrypoint: string, args: string[]) {
  console.log(`\n[e2e setup] ${label}`);
  const result = spawnSync(process.execPath, [entrypoint, ...args], {
    cwd: process.cwd(),
    env: commandEnvironment,
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}`);
  }
}

const prismaCli = path.resolve(process.cwd(), "node_modules", "prisma", "build", "index.js");
const tsxCli = path.resolve(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

run("generate Prisma Client", prismaCli, ["generate"]);
run("apply migrations to projectmemo-e2e.db", prismaCli, ["migrate", "deploy"]);
run("seed the isolated database", tsxCli, ["prisma/seed.ts"]);

console.log(`\n[e2e setup] Ready: ${E2E_DATABASE_PATH}`);
