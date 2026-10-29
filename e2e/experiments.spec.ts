import {test,expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {E2E_ENV} from "../scripts/e2e-env";
function fixture(op:string,id:string){const text=execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-ct56-fixture.ts",op,id],{env:{...process.env,...E2E_ENV},timeout:30000}).toString();return JSON.parse(text||"null");}
test("fixed metric job uses its own approval and receipt; correction makes it historical",async({page},testInfo)=>{
 const session=(await page.context().cookies()).find(c=>c.name==="pm_session")!,me=await page.request.get("/api/auth/me",{headers:{Authorization:"Bearer "+session.value}});expect(me.ok()).toBe(true);const f=fixture("create",(await me.json()).user.id);
 try{
  await page.goto(`/projects/${f.projectId}/missions?mission=${f.missionId}`);
  await page.getByText(/公开资料与获取记录（/).click();await expect(page.getByText(/论文元数据与摘要，未读取全文/)).toBeVisible();
  await expect(page.getByRole("button",{name:"批准固定核算",exact:true})).toBeVisible();
  await page.getByText("核算输入与条件",{exact:true}).click();await expect(page.getByRole("cell",{name:"D@1",exact:true})).toHaveCount(2);
  await page.screenshot({path:testInfo.outputPath("metric-approval.png"),fullPage:true});
  const approvalReply=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/approvals/"));
  await page.getByRole("button",{name:"批准固定核算",exact:true}).click();expect((await approvalReply).ok()).toBe(true);fixture("execute",f.projectId);
  await expect(page.getByText("固定脚本核算已完成。",{exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByText(/同条件差值：-0.1/)).toBeVisible();
  await page.screenshot({path:testInfo.outputPath("metric-receipt.png"),fullPage:true});
  fixture("revoke",f.projectId);await page.reload();await page.getByText(/公开资料与获取记录（/).click();await expect(page.getByText(/论文元数据与摘要，未读取全文 · 来源已变化/)).toBeVisible();
  fixture("correct",f.projectId);await page.reload();await expect(page.getByText("原指标依据已变化，此回执仅作历史记录。",{exact:true})).toBeVisible();
 }finally{fixture("remove",f.projectId);}
});
