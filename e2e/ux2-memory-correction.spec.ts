import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ENV } from "../scripts/e2e-env";
function fixture(script: string, args: string[]) {
  return execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), script, ...args],
    { env: { ...process.env, ...E2E_ENV }, timeout: 30000 }).toString();
}
test("UX2: 原文纠正跨刷新保留，旧批准拒绝，撤回保留历史", async ({ page }) => {
  test.setTimeout(90000);
  const token = (await page.context().cookies()).find(c => c.name === "pm_session")!.value;
  const headers = { Authorization: "Bearer " + token };
  const me = await page.request.get("/api/auth/me", { headers });
  const f = JSON.parse(fixture("scripts/e2e-continuity-fixture.ts", ["create", (await me.json()).user.id]));
  try {
    const original = JSON.parse(fixture("scripts/e2e-ux2-fixture.ts", [f.conversationId]));
    await page.goto("/focus?conversation=" + f.conversationId);
    const message = page.locator("#conversation-message-" + original.messageId);
    await message.getByRole("button", { name: "纠正", exact: true }).click();
    const correction = page.getByRole("dialog", { name: "纠正对这条回答的理解" });
    const raw = correction.getByRole("textbox", { name: "选择需要纠正的原文" });
    await expect(raw).toHaveValue(original.content);
    await raw.click(); await raw.press("ControlOrMeta+A");
    await correction.getByRole("textbox", { name: "应怎样理解" }).fill("52ms只是口头报告，不能当作实测达标。");
    await correction.getByRole("button", { name: "保存纠正", exact: true }).click();
    await expect(correction.getByText("当前纠正", { exact: true })).toBeVisible();
    const denied = await page.request.post(`/api/conversations/${f.conversationId}/proposals/${f.old.executionId}/confirm`,
      { headers, data: { requestId: "ux2-old-button", proposalHash: f.old.proposalHash, confirmed: true } });
    expect(denied.status()).toBe(409);
    await page.reload(); await page.locator("#conversation-message-" + original.messageId).getByRole("button", { name: "纠正", exact: true }).click();
    await expect(correction.getByText("52ms只是口头报告，不能当作实测达标。", { exact: true })).toBeVisible();
    await correction.getByRole("button", { name: "撤回这次纠正" }).click();
    await expect(correction.getByText("历史纠正", { exact: true })).toBeVisible();
    await expect(correction.getByRole("button", { name: "撤回这次纠正" })).toHaveCount(0);
    await page.screenshot({ path: "evidence/r4-agent-ux/20261030-ux2/web-correction.png", fullPage: true });
  } finally { fixture("scripts/e2e-continuity-fixture.ts", ["remove", f.projectId]); }
});
test("UX2: 记忆页显示带来源综合与待核实，并回原讨论接续", async ({ page }) => {
  test.setTimeout(90000);
  const token = (await page.context().cookies()).find(c => c.name === "pm_session")!.value;
  const headers = { Authorization: "Bearer " + token };
  const me = await page.request.get("/api/auth/me", { headers });
  const f = JSON.parse(fixture("scripts/e2e-continuity-fixture.ts", ["create", (await me.json()).user.id]));
  try {
    const seeded = JSON.parse(fixture("scripts/e2e-ux2-fixture.ts", ["memory", f.conversationId]));
    await page.goto("/projects/" + f.projectId + "/knowledge");
    await page.locator("summary", { hasText: "当前理解与待核实" }).click();
    await expect(page.getByText(seeded.summary, { exact: true })).toBeVisible();
    const hypothesis = page.locator("article").filter({ hasText: seeded.hypothesis });
    await expect(hypothesis.getByText(seeded.hypothesis, { exact: true })).toBeVisible();
    await expect(hypothesis.getByText("待核实", { exact: true })).toBeVisible();
    await hypothesis.locator("summary", { hasText: "条件与依据" }).click();
    await expect(hypothesis.getByRole("link", { name: "回原讨论接续" })).toHaveAttribute("href", new RegExp(f.conversationId));
    await expect(hypothesis.getByText("纠正理解")).toBeVisible();
    await page.screenshot({ path: "evidence/r4-agent-ux/20261030-ux2/web-memory-panel.png", fullPage: true });
  } finally { fixture("scripts/e2e-continuity-fixture.ts", ["remove", f.projectId]); }
});
