/** M2 browser acceptance. Start a fresh v2-entry-demo with V2_ENTRY_PORT=4430 first. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { docxMaterial } from "./fixtures/docx-material";
const port = Number(process.env.V2_ENTRY_PORT ?? 4430), origin = "http://127.0.0.1:" + port;
const out = path.resolve("evidence/v2-first-loop/m2-materials-20261117/browser"); fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage(), errors: string[] = [], checks: string[] = [];
page.on("pageerror", error => errors.push(error.message));
page.on("response", response => { if (response.status() >= 500) errors.push(response.status() + " " + response.url()); });
async function observed(id: string, versions: number) {
  for (let index = 0; index < 180; index++) {
    const response = await context.request.get(origin + "/api/missions/" + id + "/workbench");
    if (response.ok()) {
      const value = await response.json();
      if (value.outputs.length === versions && value.phase === "WAITING_OBSERVATION") return value;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Expected " + versions + " delivered versions");
}
try {
  await page.goto("http://127.0.0.1:" + (port + 1) + "/open");
  await page.getByLabel("起步场景").waitFor({ timeout: 90000 });
  await page.getByLabel("起步场景").selectOption("client");
  assert.match(await page.getByLabel("这次要完成什么").inputValue(), /客户交付/);
  await page.getByLabel("导入材料文件").setInputFiles({ name: "broken.csv", mimeType: "text/csv", buffer: Buffer.from("项目,状态\n缺一列") });
  await page.getByRole("button", { name: "预览持续范围" }).click();
  await page.getByRole("alert").filter({ hasText: "CSV" }).waitFor();
  const material = '项目,状态,说明\n登录,完成,已记录\n移动端,待确认,"分享入口,尚未验证"';
  await page.getByLabel("导入材料文件").setInputFiles({ name: "客户brief.csv", mimeType: "text/csv", buffer: Buffer.from(material) });
  await page.getByRole("button", { name: "预览持续范围" }).click();
  await page.getByRole("heading", { name: "确认这次持续跟进的范围" }).waitFor();
  await page.getByText("仅本项目资料；关闭此项目的个人上下文").waitFor();
  await page.getByText("客户brief.csv · 2 行数据，3 列").waitFor();
  await page.getByText("材料预览", { exact: true }).click();
  await page.locator("pre").filter({ hasText: "分享入口" }).waitFor({ state: "visible" });
  assert.match(await page.locator("pre").textContent() ?? "", /分享入口/);
  checks.push("client preset -> malformed CSV rejected -> valid original CSV preview + explicit project-only memory scope");
  let dropped = false;
  const requestIds: string[] = [];
  await page.route("**/v2-delegation/confirm", async route => {
    requestIds.push(route.request().postDataJSON().requestId);
    if (!dropped) { dropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "确认并开始" }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "返回修改" }).isDisabled(), true);
  await page.getByRole("button", { name: "确认并开始" }).click();
  await page.waitForURL(/\/v2\/workbench\?missionId=/, { timeout: 90000 });
  assert.equal(new Set(requestIds).size, 1);
  const id = new URL(page.url()).searchParams.get("missionId")!;
  const first = await observed(id, 1);
  await page.getByRole("button", { name: "第 1 版", exact: true }).waitFor();
  checks.push("lost confirmation response -> same request retry -> one Mission + private first draft");
  await page.getByRole("button", { name: "补充材料或反馈" }).click();
  await page.getByLabel("导入材料文件").setInputFiles({ name: "bad.csv", mimeType: "text/csv", buffer: Buffer.from("项目,意见\n缺一列") });
  await page.getByRole("button", { name: "保存到原项目" }).click();
  await page.getByRole("alert").filter({ hasText: "CSV" }).waitFor();
  assert.equal(await page.getByLabel("补充内容").isEnabled(), true);
  await page.getByLabel("导入材料文件").setInputFiles({ name: "损坏.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("invalid") });
  await page.getByRole("alert").filter({ hasText: "DOCX 无法提取文字" }).waitFor();
  await page.getByLabel("导入材料文件").setInputFiles({ name: "客户反馈.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(docxMaterial("客户希望补充分享入口的说明，验收口径仍未确认。")) });
  await page.getByText("客户反馈.docx · 仅正文与表格文字，不含图片和排版").waitFor();
  assert.match(await page.getByLabel("补充内容").inputValue(), /001/);
  let feedbackDropped = false;
  const materialIds: string[] = [];
  await page.route("**/api/missions/*/materials", async route => {
    materialIds.push(route.request().postDataJSON().requestId);
    if (!feedbackDropped) { feedbackDropped = true; await route.fetch(); await route.abort("failed"); } else await route.continue();
  });
  await page.getByRole("button", { name: "保存到原项目" }).click();
  await page.getByRole("button", { name: "重试原材料" }).waitFor();
  assert.equal(await page.getByLabel("补充内容").isDisabled(), true);
  await page.getByRole("button", { name: "重试原材料" }).click();
  const second = await observed(id, 2);
  assert.equal(new Set(materialIds).size, 1); assert.equal(second.id, id);
  assert.equal(second.outputs.find((o: { revision: number }) => o.revision === 1).id, first.outputs[0].id);
  assert.match(JSON.stringify(second.outputs[0].blocks), /不代表已确认变更/);
  assert.equal(second.events.filter((event: { label: string }) => event.label === "你的反馈已保存，等待核对影响").length, 1);
  await page.getByRole("button", { name: "重新读取" }).click();
  await page.getByRole("button", { name: "第 2 版", exact: true }).waitFor();
  await page.getByRole("button", { name: "修改对照", exact: true }).click();
  await page.getByRole("button", { name: "定位原记录 · 客户反馈.docx", exact: true }).click();
  assert.match(await page.getByTestId("source-excerpt").innerText(), /客户希望补充分享入口/);
  checks.push("damaged DOCX rejected; valid DOCX body + table -> actual workbench feedback -> idempotent retry -> same Mission revision 2; feedback remains unconfirmed");
  await page.screenshot({ path: path.join(out, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 360, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: path.join(out, "mobile.png"), fullPage: true });
  checks.push("360px: no horizontal overflow; original evidence and both report versions remain accessible");
  assert.deepEqual(errors, []);
  fs.writeFileSync(path.join(out, "receipt.json"), JSON.stringify({ at: new Date().toISOString(), data: "isolated synthetic SQLite", provider: "localhost mock HTTP", checks, errors, realModelQualityVerified: false }, null, 2));
  console.log("M2_BROWSER_PASS\n" + checks.join("\n"));
} catch (error) {
  await page.screenshot({ path: path.join(out, "failure.png"), fullPage: true }); throw error;
} finally { await browser.close(); }
