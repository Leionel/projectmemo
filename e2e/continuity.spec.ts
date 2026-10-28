import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { E2E_ENV } from "../scripts/e2e-env";
function fixture(op: string, id: string) { return execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/e2e-continuity-fixture.ts", op, id], { env: { ...process.env, ...E2E_ENV }, timeout: 30000 }).toString(); }
test("CT1 direction correction, stale confirmation, original Mission resume, withdrawal and draft continuity", async ({ page }) => {
  test.setTimeout(90000);
  const session = (await page.context().cookies()).find(c => c.name === "pm_session")!;
  const headers = { Authorization: "Bearer " + session.value };
  const me = await page.request.get("/api/auth/me", { headers }); expect(me.ok()).toBe(true);
  const f = JSON.parse(fixture("create", (await me.json()).user.id));
  try {
    await page.goto("/focus?conversation=" + f.conversationId);
    const panel = page.getByRole("region", { name: "问忆程", exact: true });
    const ct = panel.getByRole("region", { name: "当前工作与接续" });
    const draft = panel.getByRole("textbox", { name: "与忆程讨论项目" });
    await draft.fill("保留这段尚未发送的追问");
    await ct.getByRole("button", { name: "调整当前方向" }).click();
    await ct.getByRole("textbox", { name: "更正当前工作方向" }).fill("本周先稳演示，先别加功能");
    await ct.getByRole("button", { name: "按这句话调整" }).click();
    await expect(ct.getByText("当前重点：", { exact: false })).toBeVisible();
    await expect(draft).toHaveValue("保留这段尚未发送的追问");
    await expect(panel.getByText("方向或依据已变化，请重新预览")).toBeVisible();
    const rejected = await page.request.post(`/api/conversations/${f.conversationId}/proposals/${f.old.executionId}/confirm`, { headers,
      data: { requestId: "old-button", proposalHash: f.old.proposalHash, confirmed: true } });
    expect(rejected.status()).toBe(409); expect((await rejected.json()).error.code).toBe("CONTINUITY_CHANGED");
    await ct.getByRole("button", { name: "整理演示记录", exact: true }).click();
    await panel.getByRole("button", { name: "预览接续原委托", exact: true }).click();
    await panel.getByRole("button", { name: "确认此操作", exact: true }).click();
    await expect(ct.getByText("Agent 处理中", { exact: false })).toBeVisible();
    const evidence = "evidence/r4-continuity/20261028-pr6-close-ct1/web"; fs.mkdirSync(evidence, { recursive: true });
    for (const width of [1280, 390]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: `${evidence}/ct1-direction-${width}.png`, fullPage: true }); }
    await ct.getByRole("button", { name: "撤回", exact: true }).click();
    await expect(ct.getByText("当前重点：", { exact: false })).toHaveCount(0);
    await expect(panel.getByText("方向或依据已变化，请重新预览").first()).toBeVisible();
    await expect(draft).toHaveValue("保留这段尚未发送的追问");
  } finally { fixture("remove", f.projectId); }
});
