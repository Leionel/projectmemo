import path from "node:path";

export const E2E_DATABASE_PATH = path.resolve(process.cwd(), "prisma", "projectmemo-e2e.db");
export const E2E_DATABASE_URL = `file:${E2E_DATABASE_PATH.replaceAll("\\", "/")}`;
export const E2E_PORT = 3321;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  LLM_MODE: "mock",
  NEXT_DIST_DIR: ".next-e2e",
} as const;
