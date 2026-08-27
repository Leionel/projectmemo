import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    environment: "node",
    // Test files switch DATABASE_URL and share the Prisma singleton; parallel files race on SQLite.
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "html"] },
  },
});
