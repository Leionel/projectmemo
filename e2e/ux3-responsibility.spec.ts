import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { E2E_ENV } from "../scripts/e2e-env";
function fixture(args:string[]) {
  return JSON.parse(execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-continuity-fixture.ts",...args],
    {env:{...process.env,...E2E_ENV},timeout:30000}).toString() || "null");
}
test("UX3责任：原页面保存目标与重点、刷新读回；另一端旧版本拒绝",async({page})=>{
  test.setTimeout(90000);
  const session=(await page.context().cookies()).find(c=>c.name==="pm_session")!;
  const headers={Authorization:"Bearer "+session.value};
  const me=await page.request.get("/api/auth/me",{headers});expect(me.ok()).toBe(true);
  const f=fixture(["create",(await me.json()).user.id]);
  try{
    const original=await(await page.request.get(`/api/missions/${f.missionId}/responsibility`,{headers})).json();
    await page.goto(`/projects/${f.projectId}/missions?mission=${f.missionId}`);
    await page.getByText("委托范围与累计用量",{exact:true}).click();
    await page.getByRole("button",{name:"修订责任范围",exact:true}).click();
    const panel=page.getByRole("region",{name:"运行与接续",exact:true});
    await panel.locator("textarea").fill("先核对目标设备，保留原结果链");
    await panel.locator('input[type="text"]').fill("先查启动日志");
    const saved=page.waitForResponse(r=>r.url().endsWith(`/missions/${f.missionId}/responsibility`)&&r.request().method()==="PATCH");
    await panel.getByRole("button",{name:"确认修订（失效原有提案）",exact:true}).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByText("先核对目标设备，保留原结果链",{exact:true}).first()).toBeVisible();
    const current=await(await page.request.get(`/api/missions/${f.missionId}/responsibility`,{headers})).json();
    expect(current.responsibility.workingObjective).toBe("先查启动日志");
    const stale=await page.request.patch(`/api/missions/${f.missionId}/responsibility`,{headers,data:{requestId:"stale-other-device",expectedControlVersion:original.responsibility.controlVersion,goal:"旧端目标"}});
    expect(stale.status()).toBe(409);
    await page.screenshot({path:"evidence/r4-ui-quality/20261031/after/web-responsibility-edit.png",fullPage:true});
  }finally{fixture(["remove",f.projectId]);}
});
