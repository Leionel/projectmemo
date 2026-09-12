import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    environment: "node",
    // 显式独立测试库：全量测试不再落在开发库（先运行 prisma migrate deploy 初始化）
    env: { DATABASE_URL: "file:./prisma/test-vitest.db" },
    // Test files switch DATABASE_URL and share the Prisma singleton; parallel files race on SQLite.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
