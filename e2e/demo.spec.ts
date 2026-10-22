import {openProjectDirectory} from "./projectMenu";
import { test, expect } from "@playwright/test";

async function openSeedProject(page: import("@playwright/test").Page, section = "actions") {
  await page.goto("/projects");
  const link = page.getByRole("link", { name: /人工智能创意赛 忆程 ProjectMemo 作品开发/ }).first();
  const href = await link.getAttribute("href");
  expect(href).toMatch(/^\/projects\/[^/?#]+$/);
  await page.goto(href! + (section ? `/${section}` : ""));
  if (section === "actions") await expect(page.getByRole("region", { name: "忆程主动提醒" })).toBeVisible();
}

test("accepts a proactive reminder and asks the memory copilot", async ({ page }) => {
  await openSeedProject(page);
  const interventions = page.locator('section[aria-labelledby="interventions-title"]');
  await expect(interventions).toBeVisible();
  const firstReminder = interventions.locator("article").first();
  await firstReminder.locator("button").first().click();
  const actions = page.locator('section[aria-labelledby="action-board-title"]');
  await expect(actions).toBeVisible();
  const firstAction = actions.locator("article").first();
  await firstAction.locator("button").nth(1).click();
  await firstAction.locator("textarea").fill("已完成演示闭环并记录验证结果。");
  await firstAction.locator("button").last().click();
  await expect(actions.locator('[role="status"]')).toBeVisible();
  await openProjectDirectory(page);await page.getByRole("navigation", {name:"项目功能导航"}).getByRole("link",{name:"知识与问答"}).click();
  const copilot = page.locator("#memory-copilot");
  await copilot.getByRole("button", { name: /问忆程/ }).click();
  await copilot.locator("input").fill("当前进展如何？");
  await copilot.locator("form button").click();
  await expect(copilot.locator("form")).toBeVisible();
});

test("seed project completes the core demo loop", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/focus$/);
  await page.getByRole("link", { name: "查看项目", exact: true }).click();
  await page.getByLabel("搜索项目").fill("ProjectMemo");
  await expect(page.getByText(/找到 1 个项目/)).toBeVisible();
  const seedLink = page.getByRole("link", { name: /人工智能创意赛 忆程 ProjectMemo 作品开发/ }).first();
  const seedHref = await seedLink.getAttribute("href");
  expect(seedHref).toMatch(/^\/projects\/[^/?#]+$/);
  await page.goto(seedHref!);
  await expect(page.getByRole("heading", { name: "项目概览", exact:true })).toBeVisible();
  await openProjectDirectory(page);await page.getByRole("navigation", {name:"项目功能导航"}).getByRole("link",{name:"知识与问答"}).click();
  await page.locator("#knowledge-assets").getByRole("button", { name: "完整" }).click();
  await expect(page.getByText("相关知识资产", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "查看原文" }).first().click();
  await expect(page.getByRole("region", { name: "碎片原文" })).toBeVisible();
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link", { name: "成果文档" }).click();
  await page.getByRole("button", { name: "生成新版本" }).click();
  await expect(page.getByRole("heading", { name: "人工智能创意赛 忆程 ProjectMemo 作品开发｜项目周报", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "答辩 PPT 大纲" }).click();
  await expect(page).toHaveURL(/type=defense_ppt/);
  await page.getByRole("button", { name: "生成新版本" }).click();
  await expect(page.getByText(/答辩 PPT 大纲/).last()).toBeVisible();
  await page.getByRole("button", { name: "README 草稿" }).click();
  await expect(page).toHaveURL(/type=readme/);
  await page.getByRole("button", { name: "生成新版本" }).click();
  await expect(page.getByRole("button", { name: "复制文本" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "README 草稿", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "Markdown 渲染预览" })).toBeVisible();
  await page.getByRole("button", { name: "Markdown 编辑" }).click();
  const editor = page.getByLabel("Markdown 源码编辑器");
  await editor.fill(`${await editor.inputValue()}\n\n## 人工润色\n已核对演示闭环。`);
  await page.getByRole("button", { name: "渲染预览" }).click();
  await expect(page.getByRole("heading", { name: "人工润色" })).toBeVisible();
  await page.getByRole("button", { name: "Markdown 编辑" }).click();
  await expect(editor).toHaveValue(/已核对演示闭环/);
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(page.getByRole("paragraph").filter({ hasText: "润色内容已保存为新版本" })).toBeVisible();
});

test("creates a project and captures a fragment", async ({ page }) => {
  await page.goto("/projects/new");
  await page.getByLabel("项目名称").fill(`E2E 项目 ${Date.now()}`);
  await page.getByLabel("项目描述").fill("这是一个验证项目创建和碎片沉淀流程的自动化测试项目。");
  await page.getByLabel("项目目标").fill("完成项目创建和知识卡片生成");
  await page.getByRole("button", { name: "创建项目并开始沉淀" }).click();
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link", {name:"记录与资料"}).click();
  await page.getByLabel("碎片内容").fill("老师建议先完成 Demo 闭环，再准备比赛演示文档。");
  await page.getByRole("button", { name: "沉淀为知识资产" }).click();
  await expect(page.getByText(/已生成/)).toBeVisible();
  await page.getByRole("link",{name:"查看新卡片",exact:true}).click();
  await expect(page.locator("article span").filter({ hasText: /^会议纪要$/ })).toBeVisible();
  await page.getByRole("button", { name: "纠正卡片" }).click();
  const correction = page.getByRole("region", { name: "纠正知识卡片" });
  await correction.getByLabel("标题").fill("老师建议：先完成可演示闭环");
  await correction.getByRole("button", { name: "保存纠正" }).click();
  await expect(page.getByRole("heading", { name: "老师建议：先完成可演示闭环" })).toBeVisible();
});

test("project home separates features and preserves old bookmarks", async ({page})=>{
  await openSeedProject(page, "");
  await openProjectDirectory(page);const nav=page.getByRole("navigation",{name:"项目功能导航"});
  await expect(nav.getByRole("link",{name:"项目首页",exact:true})).toHaveAttribute("aria-current","page");
  await expect(page.locator("#capture-box")).toHaveCount(0);await expect(page.locator("#mission-agent")).toHaveCount(0);await expect(page.locator("#action-board")).toHaveCount(0);
  await nav.getByRole("link",{name:"记录与资料"}).click();await expect(page).toHaveURL(/\/records$/);await expect(page.getByLabel("碎片内容")).toBeVisible();
  await nav.getByRole("link",{name:"知识与问答"}).click();await expect(page.locator("#knowledge-assets")).toBeVisible();
  const base=new URL(page.url()).pathname.replace(/\/knowledge$/,"");
  await page.goto(`${base}?cardSort=importance#knowledge-assets`);
  await expect(page).toHaveURL(/\/knowledge\?cardSort=importance#knowledge-assets$/);
  await expect(page.getByRole("button",{name:"重要",exact:true})).toHaveAttribute("aria-pressed","true");
  await page.goto(`${base}?openCopilot=1#memory-copilot`);await expect(page.getByLabel("问项目进展、提醒依据或下一步")).toBeVisible();
  await page.goto(base);await page.setViewportSize({width:1280,height:800});
  await page.screenshot({path:"test-results/pre-r4-home-desktop.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"切换深浅色主题"}).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({path:"test-results/pre-r4-home-dark.png",fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"切换深浅色主题"}).click();
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole("region",{name:"当前最重要的事项"}).getByRole("link").first()).toBeInViewport();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:"test-results/pre-r4-home-mobile.png",fullPage:true,animations:"disabled"});
  await page.setViewportSize({width:320,height:844});await page.addStyleTag({content:"html { font-size:125%; }"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.screenshot({path:"test-results/pre-r4-home-large-text.png",fullPage:true,animations:"disabled"});
});

test("project feature pages reload independently and enforce sign-in",async({page,browser})=>{
  test.setTimeout(90000);
  await openSeedProject(page, "");const base=new URL(page.url()).pathname;
  const sections=[["missions","长期委托"],["records","记录与资料"],["meetings","会议更新"],["actions","行动与提醒"],["knowledge","知识与问答"],["health","项目体检"],["generate","成果文档"]];
  for(const [path,label] of sections){
    await page.goto(`${base}/${path}`);
    await openProjectDirectory(page);await expect(page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:label,exact:true})).toHaveAttribute("aria-current","page");
    await expect(page.getByRole("heading",{name:label,exact:true})).toBeVisible();await expect(page.locator("main")).toHaveCount(1);
  }
  const anonymous=await browser.newContext({storageState:{cookies:[],origins:[]}});
  try{const anonymousPage=await anonymous.newPage();for(const suffix of ["","/records","/generate"]){
    // Streamed RSC redirects may carry HTTP 200; verify the actual destination and absence of private UI.
    await anonymousPage.goto(`${base}${suffix}`);await expect(anonymousPage).toHaveURL(/\/login\?from=/);await expect(anonymousPage.getByRole("navigation",{name:"项目功能导航"})).toHaveCount(0);
  }}finally{await anonymous.close();}
});

test("project dashboard surfaces attention state and snoozed reminder history", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByLabel("排列方式")).toHaveValue("attention");
  const projectCard = page.locator("article").filter({ hasText: /人工智能创意赛 忆程 ProjectMemo 作品开发/ }).first();
  await expect(projectCard.getByText("参赛准备度", { exact: true })).toBeVisible();
  const projectHref = await projectCard.getByRole("link", { name: /打开项目/ }).getAttribute("href");
  expect(projectHref).toMatch(/^\/projects\/[^/?#]+$/);
  await page.goto(projectHref!);

  await page.getByText("更多项目状态与目标",{exact:true}).click();
  await expect(page.getByRole("region", { name: "项目关键状态" })).toBeVisible();
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"行动与提醒"}).click();
  const interventions = page.locator('section[aria-labelledby="interventions-title"]');
  await interventions.getByText("演示控制", { exact: true }).click();
  await interventions.getByRole("button", { name: "截止 48 小时" }).click();
  const simulatedCards = interventions.locator("article").filter({ hasText: "模拟数据" });
  const simulated = simulatedCards.first();
  await expect(simulated).toBeVisible();
  const beforeSnooze = await simulatedCards.count();
  await simulated.getByRole("button", { name: "稍后" }).click();
  await expect(simulatedCards).toHaveCount(beforeSnooze - 1);
  await interventions.getByText(/最近处理/).click();
  await expect(interventions.getByText(/再提醒/).first()).toBeVisible();
});

test("creates, edits, sorts and safely cancels a detailed action", async ({ page }) => {
  await openSeedProject(page);
  const board = page.locator("#action-board");
  const title = `补齐交互验收 ${Date.now()}`;
  await board.getByLabel("新增行动标题").fill(title);
  await board.getByText("补充优先级、截止时间和说明").click();
  await board.getByLabel("新行动优先级").selectOption("5");
  await board.getByLabel("新行动截止日期").fill("2026-07-25");
  await board.getByLabel("新行动说明").fill("验证编辑、排序与取消确认。 ");
  await board.getByRole("button", { name: "新增行动", exact: true }).click();
  const action = board.locator("article").filter({ hasText: title });
  await expect(action.getByText("优先级 5/5")).toBeVisible();
  await action.getByRole("button", { name: "编辑" }).click();
  await action.getByLabel("标题").fill(`${title} 已更新`);
  await action.getByRole("button", { name: "保存" }).click();
  const updated = board.locator("article").filter({ hasText: `${title} 已更新` });
  await updated.getByRole("button", { name: "取消行动" }).click();
  await updated.getByRole("button", { name: "确认取消行动" }).click();
  await expect(updated).toBeHidden();
  await board.getByRole("button", { name: /全部/ }).click();
  await expect(board.locator("article").filter({ hasText: `${title} 已更新` }).getByText("已取消")).toBeVisible();
});

test("updates card importance and reuses a card-sourced action", async ({ page }) => {
  await openSeedProject(page, "knowledge");
  const feed = page.locator("#knowledge-assets");
  await feed.getByRole("button", { name: "完整" }).click();
  let card = feed.locator("article").filter({ hasText: "下一步建议" }).first();
  await card.getByRole("button", { name: "将重要性设为 1" }).click();
  await expect(card.getByRole("button", { name: "将重要性设为 1" })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "将重要性设为 5" }).click();
  await expect(card.getByRole("button", { name: "将重要性设为 5" })).toHaveAttribute("aria-pressed", "true");
  const [created] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/actions")),
    card.getByRole("button", { name: "加入待办" }).first().click(),
  ]);
  expect(created.status()).toBe(201);
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"行动与提醒"}).click();
  await expect(page.locator("#action-board article")).toHaveCount(1);

  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"知识与问答"}).click();
  await page.locator("#knowledge-assets").getByRole("button", { name: "完整" }).click();
  card = page.locator("#knowledge-assets article").filter({ hasText: "下一步建议" }).first();
  const [reused] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === "POST" && response.url().endsWith("/actions")),
    card.getByRole("button", { name: "加入待办" }).first().click(),
  ]);
  expect(reused.status()).toBe(200);
  expect((await reused.json() as { reused: boolean }).reused).toBe(true);
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"行动与提醒"}).click();
  await expect(page.locator("#action-board article")).toHaveCount(1);
});

test("mobile workspace keeps project status and overview near the top", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSeedProject(page, "");
  await page.getByText("更多项目状态与目标",{exact:true}).click();
  await expect(page.getByRole("region", { name: "项目关键状态" })).toBeVisible();
  await page.getByText("查看项目目标与时间").click();
  await expect(page.getByText("项目目标：")).toBeVisible();
  await expect(page.locator("#capture-box")).toHaveCount(0);
  await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"记录与资料"}).click();
  await expect(page.locator("#capture-box")).toBeVisible();
});
