import { expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
it("E2E身份和合成额度禁止写入其他数据库或非mock环境", () => {
  const candidate = path.resolve("tmp", "must-not-create-e2e-auth-guard.db");
  expect(fs.existsSync(candidate)).toBe(false);
  for (const env of [
    { DATABASE_URL: "file:" + candidate.replaceAll("\\", "/"), LLM_MODE: "mock" },
    { DATABASE_URL: "file:" + path.resolve("prisma/projectmemo-e2e.db").replaceAll("\\", "/"), LLM_MODE: "openai-compatible" },
  ]) {
    const result = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/seed-e2e-auth.ts"], {
      env: { ...process.env, ...env }, encoding: "utf8", timeout: 15000,
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("仅允许在隔离 E2E 数据库和 mock 模式创建测试身份");
  }
  expect(fs.existsSync(candidate)).toBe(false);
});
