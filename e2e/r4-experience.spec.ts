import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ENV } from "../scripts/e2e-env";
function fixture(operation: "create" | "remove", id: string, script = "scripts/e2e-r4-fixture.ts") {
  return execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), script, operation, id],
    { env: { ...process.env, ...E2E_ENV }, timeout: 30000, maxBuffer: 1024 * 1024 }).toString();
}
test("R4 native Web blocks keep drafts and confirm one original Action on desktop and phones", async ({ page }) => {
  test.setTimeout(75000);
  const session = (await page.context().cookies()).find(c => c.name === "pm_session")!;
  const me = await page.request.get("/api/auth/me", { headers: { Authorization: "Bearer " + session.value } }); expect(me.ok()).toBe(true);
  const user = (await me.json()).user, data = JSON.parse(fixture("create", user.id).trim());
  try {
    await page.goto("/focus?conversation=" + data.conversationId);
    const panel = page.getByRole("region", { name: "问忆程", exact: true });
    await expect(panel.getByTestId("agent-message-blocks")).toBeVisible();
    await expect(panel.getByRole("heading", { name: "离目标还差什么" })).toBeVisible();
    await panel.getByRole("button", { name: "在此协作", exact: true }).first().click();
    const draft = panel.getByRole("textbox", { name: "原问题答复" }); await draft.fill("设备信息待确认，先保留这个草稿。");
    await panel.getByRole("textbox", { name: "与忆程讨论项目" }).fill("目前还有什么待处理？");
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await expect(panel.getByRole("textbox", { name: "与忆程讨论项目" })).toHaveValue("");
    await expect(draft).toHaveValue("设备信息待确认，先保留这个草稿。");
    await panel.getByRole("button", { name: "收起原任务协作" }).click();
    await panel.getByRole("button", { name: "在此协作", exact: true }).first().click();
    await expect(draft).toHaveValue("设备信息待确认，先保留这个草稿。");
    await panel.getByRole("button", { name: "收起原任务协作" }).click();
    const screenshotDir = process.env.FOCUS_EVIDENCE_DIR ?? "test-results/r4-experience";
    for (const width of [1280, 360, 390, 430]) {
      await page.setViewportSize({ width, height: 900 });
      const approve = panel.getByRole("button", { name: "确认创建行动", exact: true });
      await approve.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(approve).toBeEnabled();
      await page.screenshot({ path: screenshotDir + `/r4-approval-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: "切换深浅色主题" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.screenshot({ path: screenshotDir + "/r4-dark-1280.png", fullPage: true });
    await page.getByRole("button", { name: "切换深浅色主题" }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "20px"; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const approve = panel.getByRole("button", { name: "确认创建行动", exact: true });
    await approve.focus(); await expect(approve).toBeFocused();
    await approve.scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotDir + "/r4-large-text-390.png", fullPage: true });
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    await page.setViewportSize({ width: 430, height: 900 });
    const response = page.waitForResponse(r => r.url().endsWith("/ui-actions") && r.request().method() === "POST");
    await panel.getByRole("button", { name: "确认创建行动", exact: true }).click();
    const result = await (await response).json(); expect(result.actionId).toBeTruthy();
    await expect(panel.getByRole("region", { name: "原业务回执" })).toContainText("行动已创建");
    await expect(panel.getByRole("region", { name: "原业务回执" })).toContainText("等待执行");
    await expect(panel.getByRole("region", { name: "原业务回执" })).toBeInViewport();
    await page.reload();
    await expect(panel.getByRole("region", { name: "原业务回执" })).toContainText("行动已创建");
    await panel.getByRole("region", { name: "原业务回执" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotDir + "/r4-receipt-430.png", fullPage: true });
  } finally { fixture("remove", data.projectId); }
});

test("R4 original D1/D2 comparison exposes branches and previews without executing", async ({ page }) => {
  const session = (await page.context().cookies()).find(c => c.name === "pm_session")!;
  const me = await page.request.get("/api/auth/me", { headers: { Authorization: "Bearer " + session.value } });
  const user = (await me.json()).user, script = "scripts/e2e-r4-review-fixture.ts", data = JSON.parse(fixture("create", user.id, script).trim());
  try {
    await page.goto("/focus?conversation=" + data.conversationId);
    const panel = page.getByRole("region", { name: "问忆程", exact: true });
    await expect(panel.locator('[data-block="change"]')).toContainText("当前两个算法使用不同划分");
    const comparison = panel.getByRole("region", { name: "方案比较", exact: true });
    await expect(comparison).toContainText("是否存在同一 S2 条件的输出");
    await comparison.getByRole("button", { name: /核对已有输出/ }).click();
    await comparison.getByText("什么情况下继续或停止", { exact: true }).click();
    await expect(comparison).toContainText("同条件输出已存在 → 继续做对照");
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await comparison.scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await page.screenshot({ path: (process.env.FOCUS_EVIDENCE_DIR ?? "test-results/r4-experience") + `/r4-review-${width}.png`, fullPage: true });
    }
    await comparison.getByRole("button", { name: "预览采用", exact: true }).click();
    await expect(panel).toContainText("采用本轮方案");
    const proposal = panel.getByRole("region", { name: "行动提案", exact: true });
    await expect(proposal).toContainText("采用本轮方案");
    await expect(proposal.getByRole("button", { name: /确认/ })).toBeEnabled();
    await page.reload();
    await expect(panel).toContainText("采用本轮方案");
  } finally { fixture("remove", data.projectId, script); }
});
