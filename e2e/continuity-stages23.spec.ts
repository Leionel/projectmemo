import { test,expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ENV } from "../scripts/e2e-env";
function fixture(op:string,id:string){return JSON.parse(execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-stages23-fixture.ts",op,id],{env:{...process.env,...E2E_ENV},timeout:30000}).toString()||"null");}
test("CT2 explicit CI/log grant and CT3 bounded delegation can be understood and withdrawn",async({page})=>{
 test.setTimeout(90000);const session=(await page.context().cookies()).find(c=>c.name==="pm_session")!;const me=await page.request.get("/api/auth/me",{headers:{Authorization:"Bearer "+session.value}});expect(me.ok()).toBe(true);const f=fixture("create",(await me.json()).user.id);
 try{
  await page.goto(`/projects/${f.projectId}/knowledge`);const repos=page.locator("#repo-signals");await repos.locator("summary").click();
  await repos.getByRole("button",{name:"允许 Agent 读取 CI 状态",exact:true}).click();
  await expect(repos.getByRole("button",{name:"停止 CI 读取",exact:true})).toBeVisible();
  await repos.getByRole("button",{name:"允许读取脱敏的失败日志",exact:true}).click();
  await expect(repos.getByRole("button",{name:"停止日志读取",exact:true})).toBeVisible();
  await repos.getByRole("button",{name:"停止 CI 读取",exact:true}).click();
  await expect(repos.getByRole("button",{name:"允许 Agent 读取 CI 状态",exact:true})).toBeVisible();
  await page.goto(`/projects/${f.projectId}/missions?mission=${f.missionId}`);
  const details=page.locator("details").filter({has:page.locator("summary").filter({hasText:"持续调查与打扰方式"})}).last();await details.locator("summary").click();
  await details.getByLabel("持续调查截止时间").fill(new Date(Date.now()+86400000).toISOString().slice(0,16));
  await details.getByRole("button",{name:"允许按此期限和总预算持续调查"}).click();
  await expect(details.getByRole("button",{name:"撤销持续调查"})).toBeVisible();
  await details.getByRole("button",{name:"撤销持续调查"}).click();
  await expect(details.getByRole("button",{name:"撤销持续调查"})).toHaveCount(0);
  await page.screenshot({path:`evidence/r4-continuity/stages23-${Date.now()}.png`,fullPage:true});
 }finally{fixture("remove",f.projectId);}
});
