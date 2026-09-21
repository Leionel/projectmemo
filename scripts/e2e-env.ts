import path from "node:path";

export const E2E_DATABASE_PATH = path.resolve(process.cwd(), "prisma", "projectmemo-e2e.db");
export const E2E_DATABASE_URL = `file:${E2E_DATABASE_PATH.replaceAll("\\", "/")}`;
const configuredPort = Number(process.env.PROJECTMEMO_E2E_PORT ?? "33321");
if (!Number.isInteger(configuredPort) || configuredPort < 1024 || configuredPort > 65535) {
  throw new Error("PROJECTMEMO_E2E_PORT 必须是 1024–65535 之间的整数");
}
// 可通过环境变量避开 VPN/代理占用的本地端口；33321 仅是默认值，不写入产品配置。
export const E2E_PORT = configuredPort;
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
