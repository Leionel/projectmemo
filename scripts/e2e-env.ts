import path from "node:path";

export const E2E_DATABASE_PATH = path.resolve(process.cwd(), "prisma", "projectmemo-e2e.db");
export const E2E_DATABASE_URL = `file:${E2E_DATABASE_PATH.replaceAll("\\", "/")}`;
export const E2E_PORT = 3321;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

// 页面接入鉴权后，E2E 需要自己的身份。这套凭据只存在于每次重建的隔离库中，
// 不写进 prisma/seed.ts，避免污染开发库和演示库。
export const E2E_USERNAME = "e2e-reviewer";
export const E2E_PASSWORD = "e2e-reviewer-password";
export const E2E_AUTH_STATE_PATH = path.resolve(process.cwd(), "test-results", ".auth", "e2e-user.json");

export const E2E_ENV = {
  DATABASE_URL: E2E_DATABASE_URL,
  LLM_MODE: "mock",
  NEXT_DIST_DIR: ".next-e2e",
} as const;
