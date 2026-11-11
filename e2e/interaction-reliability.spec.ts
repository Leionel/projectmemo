import { test, expect } from "@playwright/test";

test("讨论附件限制、移除失败恢复和后台提交在桌面与手机可用", async ({ page }, testInfo) => {
  const token = (await page.context().cookies()).find(cookie => cookie.name === "pm_session")!.value;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/conversations", { headers, data: { requestId: crypto.randomUUID(), scope: "WORKSPACE" } });
  expect(created.ok(), await created.text()).toBe(true);
  const { id } = await created.json();
  await page.goto(`/focus?conversation=${id}`);
  const panel = page.getByRole("region", { name: "问忆程", exact: true });
  await expect(panel.getByRole("button", { name: "添加附件" })).toBeEnabled();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  for (let index = 0; index < 5; index++) {
    await panel.locator('input[type="file"]').setInputFiles({ name: `${"实验记录".repeat(20)}-${index}.png`, mimeType: "image/png", buffer: Buffer.concat([png, Buffer.from([index])]) });
    await panel.getByRole("button", { name: /仅用于本次讨论/ }).click();
    await expect(panel.getByRole("list", { name: "本轮附件" }).locator("li")).toHaveCount(index + 1);
    await expect(panel.getByRole("button", { name: "添加附件" })).toBeEnabled();
  }
  await panel.locator('input[type="file"]').setInputFiles({ name: "第六份.png", mimeType: "image/png", buffer: png });
  await expect(panel.getByRole("button", { name: /仅用于本次讨论/ })).toBeDisabled();
  await expect(panel.getByText("每次最多附加 5 个文件，请先移除一个附件")).toBeVisible();
  await panel.getByRole("button", { name: "取消", exact: true }).click();

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const chipHeights = await panel.getByRole("list", { name: "本轮附件" }).locator("li").evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
    expect(Math.max(...chipHeights)).toBeLessThanOrEqual(64);
    await expect(panel.getByRole("textbox", { name: "与忆程讨论项目" })).toBeInViewport();
    await expect(panel.getByRole("button", { name: "发送", exact: true })).toBeInViewport();
    if (width === 390) {
      const box = await panel.getByRole("button", { name: /移除附件/ }).first().boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: testInfo.outputPath(`attachments-${width}.png`), fullPage: true });
  }

  const removal = `**/api/conversations/${id}/attachments/*`;
  await page.route(removal, route => route.fulfill({ status: 503, json: { error: { message: "暂时无法移除附件，请重试" } } }));
  await panel.getByRole("button", { name: /移除附件/ }).first().click();
  await expect(panel.getByRole("alert")).toContainText("暂时无法移除附件，请重试");
  await expect(panel.getByRole("list", { name: "本轮附件" }).locator("li")).toHaveCount(5);
  await page.unroute(removal);
  await panel.getByRole("button", { name: /移除附件/ }).first().click();
  await expect(panel.getByRole("list", { name: "本轮附件" }).locator("li")).toHaveCount(4);

  const requestIds: string[] = [];
  await page.route(`**/api/conversations/${id}/turns`, async route => {
    requestIds.push(route.request().postDataJSON().requestId);
    const response = await page.request.get(`/api/conversations/${id}`, { headers });
    await route.fulfill({ json: { status: "OBSERVING", conversation: await response.json() } });
  });
  const input = panel.getByRole("textbox", { name: "与忆程讨论项目" });
  for (let index = 0; index < 2; index++) {
    await input.fill("查看实验进展");
    await panel.getByRole("button", { name: "发送", exact: true }).click();
    await expect(input).toHaveValue("");
  }
  expect(requestIds).toHaveLength(2);
  expect(requestIds[0]).not.toBe(requestIds[1]);
});

test("两端共用的消息操作保留图标语义，Web 行动主次操作在手机端集中显示", async ({ page }, testInfo) => {
  const token = (await page.context().cookies()).find(cookie => cookie.name === "pm_session")!.value;
  const headers = { Authorization: `Bearer ${token}` };
  const created = await page.request.post("/api/projects", { headers, data: {
    title: "图标和行动排布核验", description: "隔离数据库的合成项目", goal: "核对部署日志", scenario: "RESEARCH",
  } });
  expect(created.ok(), await created.text()).toBe(true);
  const { project } = await created.json();
  const captured = await page.request.post(`/api/projects/${project.id}/captures`, { headers, data: {
    requestId: crypto.randomUUID(), rawText: "实验部署记录：设备 D 的内存峰值为 6.8GB，需要补充复测。", sourceType: "实验记录",
  } });
  expect(captured.ok(), await captured.text()).toBe(true);
  const opened = await page.request.post("/api/conversations", { headers, data: { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: project.id } });
  const { id } = await opened.json();
  await page.goto(`/focus?conversation=${id}`);
  const panel = page.getByRole("region", { name: "问忆程", exact: true });
  const input = panel.getByRole("textbox", { name: "与忆程讨论项目" });
  const question = "实验部署记录还需要核对什么？";
  await input.fill(question);
  await panel.getByRole("button", { name: "发送", exact: true }).click();
  const sources = panel.getByRole("button", { name: /资料 \d+，查看本次回答的资料/ }).first();
  await expect(sources).toBeVisible();
  await sources.click();
  await expect(page.getByRole("dialog", { name: "本次回答的资料" })).toBeVisible();
  await page.getByRole("dialog", { name: "本次回答的资料" }).getByRole("button", { name: "关闭", exact: true }).click();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const tools = sources.locator("..").getByRole("button");
    expect(await panel.getByText(question, { exact: true }).evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBe(16);
    for (const button of await tools.all()) {
      await expect(button.locator("svg")).toHaveCount(1);
      expect(await button.locator("svg").evaluate(element => element.getBoundingClientRect().width)).toBeLessThanOrEqual(16);
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`message-icons-${width}.png`), fullPage: true });
  }
  await panel.getByRole("button", { name: "编辑", exact: true }).first().click();
  await expect(input).toHaveValue(question);

  const actionResponse = await page.request.post(`/api/projects/${project.id}/actions`, { headers, data: { title: "核对按钮排布", description: "合成行动", priority: 3 } });
  expect(actionResponse.ok(), await actionResponse.text()).toBe(true);
  const { action } = await actionResponse.json();
  await page.goto(`/projects/${project.id}/actions`);
  const card = page.locator(`#action-${action.id}`);
  await expect(card.getByRole("button", { name: "开始行动", exact: true })).toBeVisible();
  const secondary = card.getByRole("group", { name: "行动其他操作" });
  const edit = secondary.getByRole("button", { name: "编辑行动", exact: true });
  const cancel = secondary.getByRole("button", { name: "取消行动", exact: true });
  const mainBox = await card.getByRole("button", { name: "开始行动", exact: true }).boundingBox();
  const editBox = await edit.boundingBox(), cancelBox = await cancel.boundingBox();
  expect(editBox!.y).toBeGreaterThanOrEqual(mainBox!.y + mainBox!.height);
  expect(Math.abs(editBox!.y - cancelBox!.y)).toBeLessThanOrEqual(1);
  const moreBox = await secondary.locator("summary").boundingBox();
  expect(Math.abs(editBox!.y - moreBox!.y)).toBeLessThanOrEqual(1);
  await card.evaluate(element => element.scrollIntoView({ block: "center" }));
  await card.screenshot({ path: testInfo.outputPath("action-buttons-390.png") });
  await edit.click();
  await expect(card.getByRole("button", { name: "保存", exact: true })).toBeVisible();
});
