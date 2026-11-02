import { test, expect } from "@playwright/test";

/**
 * S1-A 正常入口：材料 → 可纠正理解 → 确认建项 → 材料同步。
 *
 * E2E 跑在 LLM_MODE=mock：因此“读懂材料”这一步会如实报告云模型未启用，
 * 页面回退到原文片段，用户仍可整体纠正并确认建项。真实模型理解质量属于独立 Evidence 轨，
 * 这里只证明准入、版本绑定、幂等与状态如实，不把规则模式当实模成功。
 */
test("S1-A 从材料建立项目：理解状态如实、整体纠正生效、确认后材料进入原 Capture", async ({ page }) => {
  test.setTimeout(90000);
  const session = (await page.context().cookies()).find(c => c.name === "pm_session")!;
  const headers = { Authorization: "Bearer " + session.value };
  const me = await page.request.get("/api/auth/me", { headers });
  expect(me.ok()).toBe(true);

  const material = "课程要求在 11 月 20 日前交付一个可演示的原型。目前只有一台旧平板，屏幕偶发无法点亮。";
  await page.goto("/projects/new");
  await expect(page.getByRole("heading", { name: "从材料开始" })).toBeVisible();
  await page.getByLabel("材料正文").fill(material);
  await page.getByRole("button", { name: "加入材料" }).click();
  await expect(page.getByText("材料已加入。它现在只是预览材料，不是项目目标或授权。")).toBeVisible();

  // 云处理同意是独立动作；未同意前“读懂”不可用。
  await expect(page.getByRole("button", { name: "读懂这些材料" })).toBeDisabled();
  await page.getByRole("checkbox").check();
  // 规则模式下不假装读懂：明说没有形成理解，并保留原文可供核对。
  await page.getByRole("button", { name: "读懂这些材料" }).click();
  await expect(page.getByText("规则模式", { exact: false })).toBeVisible();
  await expect(page.getByText("材料原文片段")).toBeVisible();

  await page.getByPlaceholder("例如：本周先确认设备可用性").fill("本周先确认设备可用性");
  await page.getByRole("button", { name: "按这句话调整" }).click();
  await expect(page.getByText(/^当前范围：本周先确认设备可用性/).first()).toBeVisible();

  // 同一页还有“直接填写”的手工表单，因此把字段限定在确认区域里。
  const confirmRegion = page.getByRole("region", { name: "确认项目" });
  await confirmRegion.getByLabel("项目名称").fill("S1 材料理解验收");
  await confirmRegion.getByLabel("项目描述").fill("用户接受的是自己写的目标，不是材料里的句子。");
  await confirmRegion.getByLabel("项目目标").fill("先确认旧平板能稳定演示，再决定原型方案");
  await confirmRegion.getByRole("button", { name: "确认理解，建立项目" }).click();
  await expect(page.getByText("项目已建立，材料已同步 1/1 份。", { exact: false })).toBeVisible();

  // 真实服务端回执：项目目标来自用户接受字段，材料已进入原 Capture。
  const projects = await page.request.get("/api/projects", { headers });
  const listed = (await projects.json()).projects as Array<{ id: string; title: string; goal: string }>;
  const created = listed.find(project => project.title === "S1 材料理解验收");
  expect(created).toBeTruthy();
  expect(created!.goal).toBe("先确认旧平板能稳定演示，再决定原型方案");
  // 材料经原 Capture 服务进入项目：详情里能看到记录数量与原文。
  const detail = await page.request.get(`/api/projects/${created!.id}`, { headers });
  expect(detail.ok()).toBe(true);
  const detailBody = await detail.json();
  const project = detailBody.project ?? detailBody;
  expect(project._count.captures).toBeGreaterThan(0);

  await page.getByRole("link", { name: /进入项目/ }).click();
  await expect(page).toHaveURL(new RegExp(`/projects/${created!.id}`));
  await expect(page.getByText("S1 材料理解验收").first()).toBeVisible();
});




