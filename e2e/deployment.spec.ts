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

test("许可写入后的强制读回优先于更早的在途轮询，后续撤销使用新版本",async({page})=>{
 test.setTimeout(90000);
 const token=(await page.context().cookies()).find(c=>c.name==="pm_session")!,headers={Authorization:"Bearer "+token.value};
 const me=await page.request.get("/api/auth/me",{headers}),f=fixture(["create",(await me.json()).user.id]);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 try{
  const api=`/api/projects/${f.projectId}/deployment-connections`;
  const created=await page.request.post(api,{headers,data:{requestId:crypto.randomUUID(),confirmedReadOnly:true,config:{schemaVersion:1,environment:"迟到轮询验收",origin:"https://service.example.org",expectedRelease:"before012345",expiresAt:new Date(Date.now()+86400000).toISOString()}}});expect(created.ok()).toBeTruthy();
  await page.goto(`/projects/${f.projectId}/records`);await page.getByText("工程验收与环境观察",{exact:true}).click();await page.getByRole("button",{name:"修订只读许可"}).click();
  let hold=true,started!:()=>void;const reading=new Promise<void>(r=>{started=r;});
  await page.route(`**${api}`,async route=>{
   if(hold&&route.request().method()==="GET"){hold=false;const old=await route.fetch();started();await gate;await route.fulfill({response:old});}
   else await route.continue();
  });
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await reading;
  await page.getByLabel("期望版本号或提交 SHA").fill("after012345");await page.getByRole("button",{name:"确认这些路径的只读许可"}).click();
  await expect(page.getByRole("heading",{name:"迟到轮询验收 · after012345"})).toBeVisible();
  const late=page.waitForResponse(r=>r.url().endsWith(api)&&r.request().method()==="GET");release();await late;
  await expect(page.getByRole("heading",{name:"迟到轮询验收 · after012345"})).toBeVisible();
  await page.getByRole("button",{name:"撤销读取",exact:true}).click();await expect(page.getByText("https://service.example.org · 已撤销",{exact:true})).toBeVisible();
 }finally{release();fixture(["remove",f.projectId]);}
});

test("跨端修订冲突保留用户输入，明确核对新版本后才重提许可",async({page})=>{
 test.setTimeout(90000);
 const token=(await page.context().cookies()).find(c=>c.name==="pm_session")!,headers={Authorization:"Bearer "+token.value};
 const me=await page.request.get("/api/auth/me",{headers}),f=fixture(["create",(await me.json()).user.id]);
 const config={schemaVersion:1,environment:"冲突验收",origin:"https://service.example.org",expectedRelease:"abcdef012345",expiresAt:new Date(Date.now()+86400000).toISOString()};
 try{
  const created=await page.request.post(`/api/projects/${f.projectId}/deployment-connections`,{headers,data:{requestId:crypto.randomUUID(),confirmedReadOnly:true,config}});expect(created.ok()).toBeTruthy();
  const {connection}=await created.json();
  await page.setViewportSize({width:390,height:844});
  await page.goto(`/projects/${f.projectId}/records`);await page.getByText("工程验收与环境观察",{exact:true}).click();
  await page.getByRole("button",{name:"修订只读许可"}).click();await page.getByLabel("期望版本号或提交 SHA").fill("userdraft012345");
  const other=await page.request.patch(`/api/projects/${f.projectId}/deployment-connections/${connection.id}`,{headers,data:{requestId:crypto.randomUUID(),expectedVersion:connection.revision,action:"REVISE",confirmedReadOnly:true,config:{...config,expectedRelease:"otherdevice12345"}}});expect(other.ok()).toBeTruthy();
  await page.getByRole("button",{name:"确认这些路径的只读许可"}).click();await expect(page.getByRole("alert").filter({hasText:"环境权限已变化"})).toBeVisible();
  await expect(page.getByLabel("期望版本号或提交 SHA")).toHaveValue("userdraft012345");
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("button",{name:"核对最新授权版本，保留修改"})).toBeVisible();
  const before=await page.request.get(`/api/projects/${f.projectId}/deployment-connections`,{headers});expect((await before.json()).connections[0].config.expectedRelease).toBe("otherdevice12345");
  await page.getByRole("button",{name:"核对最新授权版本，保留修改"}).click();await page.getByRole("button",{name:"确认这些路径的只读许可"}).click();
  await expect(page.getByRole("heading",{name:"冲突验收 · userdraft012345"})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }finally{fixture(["remove",f.projectId]);}
});
