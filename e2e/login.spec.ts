import { test, expect } from "@playwright/test";
import {
  E2E_EMAIL,
  E2E_PASSWORD,
  E2E_UNVERIFIED_EMAIL,
  E2E_USERNAME,
} from "../scripts/e2e-env";

test.use({ storageState: { cookies: [], origins: [] } });

// 公开登录页与邮箱登录的真实浏览器旅程。身份来自隔离 E2E 库（scripts/seed-e2e-auth.ts），
// 不连接真实邮件服务；未验证账号只验证提示与重发入口，不请求真实收件人。
test("公开登录页支持用户名或邮箱，且不展示预置凭据或外域回跳", async ({ page }) => {
  await page.goto("/login?from=https%3A%2F%2Fexample.invalid%2Foutside");
  await expect(page.getByRole("button", { name: "一键登录", exact: true })).toHaveCount(0);
  await expect(page.getByText("预置复赛演示账号", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("用户名或邮箱")).toBeVisible();
  await expect(page.getByPlaceholder("输入用户名或邮箱")).toHaveValue("");
  await expect(page.getByPlaceholder("输入你的密码", { exact: true })).toHaveValue("");
  await page.getByPlaceholder("输入用户名或邮箱").fill(E2E_USERNAME);
  await page.getByPlaceholder("输入你的密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "E2E 评审身份" })).toBeVisible();
});

test("已验证邮箱（大小写与空格规范化后）可登录同一账号与项目空间", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("输入用户名或邮箱").fill(`  ${E2E_EMAIL.toUpperCase()}  `);
  await page.getByPlaceholder("输入你的密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page).toHaveURL(/\/focus$/);
  await page.getByRole("button", { name: "账号与设置", exact: true }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "E2E 评审身份" })).toBeVisible();
});

test("未验证邮箱提示重发入口而不是密码错误，且保留已输入的邮箱", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("输入用户名或邮箱").fill(E2E_UNVERIFIED_EMAIL);
  await page.getByPlaceholder("输入你的密码", { exact: true }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.locator("#auth-error")).toContainText("请先验证注册邮箱");
  await expect(page.getByPlaceholder("输入用户名或邮箱")).toHaveValue(E2E_UNVERIFIED_EMAIL);
  await expect(page.getByRole("link", { name: "重新发送验证邮件" })).toBeVisible();
  await expect(page.getByText("账号或密码错误", { exact: false })).toHaveCount(0);
});

test("未知邮箱与错误密码返回同一失败提示且不清空标识", async ({ page }) => {
  await page.goto("/login");
  await page.getByPlaceholder("输入用户名或邮箱").fill("nobody-e2e@example.invalid");
  await page.getByPlaceholder("输入你的密码", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "登录工作台" }).click();
  await expect(page.locator("#auth-error")).toContainText("账号或密码错误");
  await expect(page.getByPlaceholder("输入用户名或邮箱")).toHaveValue(
    "nobody-e2e@example.invalid",
  );
});
