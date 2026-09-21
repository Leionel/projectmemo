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
    /**
     * 几个集成测试在 beforeAll 里把 prisma/migrations 下全部迁移逐个 exec 到独立库。
     * 本机跑完整个迁移集需要约 10–12 秒（每条迁移各自一次隐式事务与落盘），
     * 正好卡在默认 10 秒 hook 预算上：再加一条迁移就会把原本通过的用例顶成超时。
     * 这是迁移重放的真实成本，不是卡死，因此把 hook 预算放宽到 30 秒。
     */
    hookTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
