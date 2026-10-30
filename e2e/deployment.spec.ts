import {test,expect} from "@playwright/test";
import {execFileSync} from "node:child_process";
import path from "node:path";
import {E2E_ENV} from "../scripts/e2e-env";
function fixture(args:string[]){return JSON.parse(execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-continuity-fixture.ts",...args],{env:{...process.env,...E2E_ENV},timeout:30000}).toString()||"null");}
test("环境许可原页面创建、刷新读回、讨论接续和撤销；不发真实环境请求",async({page})=>{
 test.setTimeout(90000);const token=(await page.context().cookies()).find(c=>c.name==="pm_session")!,headers={Authorization:"Bearer "+token.value};
 const me=await page.request.get("/api/auth/me",{headers}),f=fixture(["create",(await me.json()).user.id]);
 try{
  await page.goto(`/projects/${f.projectId}/records`);await page.getByText("工程验收与环境观察",{exact:true}).click();
  await page.getByRole("button",{name:"连接一个只读环境"}).click();
  await page.getByLabel("环境名",{exact:true}).fill("预发布验收");await page.getByLabel("公开 HTTPS 服务地址").fill("https://service.example.org");await page.getByLabel("期望版本号或提交 SHA").fill("abcdef012345");
  const until=new Date(Date.now()+86400000);await page.getByLabel("读取许可到期时间").fill(new Date(+until-until.getTimezoneOffset()*60000).toISOString().slice(0,16));
  await page.getByRole("button",{name:"确认这些路径的只读许可"}).click();await expect(page.getByRole("heading",{name:"预发布验收 · abcdef012345"})).toBeVisible();
  await page.reload();await page.getByText("工程验收与环境观察",{exact:true}).click();await expect(page.getByText("尚无已保存观察。允许读取后，Agent 才能在原讨论或委托中检查。",{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"交给忆程调查"}).click();await expect(page).toHaveURL(/focus\?conversation=/);
  await page.goto(`/projects/${f.projectId}/records`);await page.getByText("工程验收与环境观察",{exact:true}).click();await page.getByRole("button",{name:"撤销读取",exact:true}).click();await expect(page.getByText("https://service.example.org · 已撤销",{exact:true})).toBeVisible();
 }finally{fixture(["remove",f.projectId]);}
});
