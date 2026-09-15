import { test as setup, expect } from "@playwright/test";
import { E2E_AUTH_STATE_PATH, E2E_PASSWORD, E2E_USERNAME } from "../scripts/e2e-env";

/**
 * 登录一次并把会话存成 storageState，供所有用例复用。
 * 项目页面已接入会话校验，未登录会被重定向到 /login。
 */
setup("authenticate as the E2E reviewer", async ({ page }) => {
  const response = await page.request.post("/api/auth/login", {
    data: { username: E2E_USERNAME, password: E2E_PASSWORD, client: "web" },
  });

  expect(response.status(), await response.text()).toBe(200);

  await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
});
