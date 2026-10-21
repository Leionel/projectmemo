import { test, expect } from "@playwright/test";
import { E2E_USERNAME, E2E_PASSWORD } from "../scripts/e2e-env";

test.use({ storageState: { cookies: [], origins: [] } });

test("公开登录页不展示预置凭据，登录后拒绝外域回跳", async ({ page }) => {
  await page.goto("/login?from=https%3A%2F%2Fexample.invalid%2Foutside");
  await expect(page.getByRole("button", { name: "一键登录", exact: true })).toHaveCount(0);
  await expect(page.getByText("预置复赛演示账号", { exact: true })).toHaveCount(0);
  await expect(page.getByPlaceholder("请输入评审账号")).toHaveValue("");
  await expect(page.getByPlaceholder("请输入密码", { exact: true })).toHaveValue("");
  await page.getByPlaceholder("请输入评审账号").fill(E2E_USERNAME);
  await page.getByPlaceholder("请输入密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "进入演示空间" }).click();
  await expect(page).toHaveURL(/\/projects$/);
});
