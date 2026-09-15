import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_STATE_PATH, E2E_BASE_URL } from "./scripts/e2e-env";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e-results.json" }]],
  timeout: 45_000,
  use: {
    baseURL: E2E_BASE_URL,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: E2E_AUTH_STATE_PATH },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
