import {test,expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {E2E_ENV} from "../scripts/e2e-env";
function fixture(op:string,id:string){return JSON.parse(execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-document-fixture.ts",op,id],{env:{...process.env,...E2E_ENV},timeout:30000}).toString()||"null");}
test("document citation opens original physical page and becomes unavailable after correction",async({page})=>{
 const session=(await page.context().cookies()).find(c=>c.name==="pm_session")!,me=await page.request.get("/api/auth/me",{headers:{Authorization:"Bearer "+session.value}});expect(me.ok()).toBe(true);const f=fixture("create",(await me.json()).user.id);
 try{await page.goto(`/projects/${f.projectId}/missions?mission=${f.missionId}`);const sources=page.locator("details").filter({has:page.locator("summary").filter({hasText:"文档原页与引用"})}).last();await sources.locator("summary").click();const opened=page.waitForEvent("popup");await sources.getByRole("link",{name:/rules.pdf · 物理第 2 页/}).click();const view=await opened;await expect(view.getByRole("heading",{name:"rules.pdf"})).toBeVisible();await expect(view.getByText("Appendix 2025",{exact:false})).toBeVisible();await expect(view.getByRole("link",{name:/打开 PDF 第 2 物理页/})).toHaveAttribute("href",`/api/projects/${f.projectId}/attachments/${f.attachmentId}/file#page=2`);fixture("correct",f.projectId);await view.reload();await expect(view.getByRole("alert").filter({hasText:"文档观察与原件"})).toContainText("不一致");await view.close();}
 finally{fixture("remove",f.projectId);}
});
