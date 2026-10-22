import {openProjectDirectory} from "./projectMenu";
import {test,expect} from "@playwright/test";
import {E2E_ENV} from "../scripts/e2e-env";
import {execFileSync} from "node:child_process";
import path from "node:path";
type State={status:string;events:Array<{type:string}>;steps:Array<{toolName:string;resultJson:{sources?:Array<{id:string}>}|null}>;actions:Array<{title:string;status:string}>;approvals:Array<{status:string}>;receipt:{artifactId:string;outputId:string}|null};
function fixture(operation:string,id:string,choice?:import("../lib/mission/contracts").Choice):State{
 const output=execFileSync(process.execPath,[path.resolve("node_modules/tsx/dist/cli.mjs"),"scripts/e2e-mission-fixture.ts",operation,id,...(choice?[JSON.stringify(choice)]:[])],{env:{...process.env,...E2E_ENV},encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024});return JSON.parse(output);
}
async function slice(id:string,choice:import("../lib/mission/contracts").Choice){return fixture("slice",id,choice);}
async function scan(id:string){return fixture("scan",id);}
test("same Mission survives reload, receives metric, auto continues, waits for approval and adopts a reusable draft",async({page})=>{
 test.setTimeout(120000);
 await page.goto("/projects/new");await page.getByLabel("项目名称").fill(`E2E Mission ${Date.now()}`);await page.getByLabel("项目描述").fill("独立的Mission接续测试项目");await page.getByLabel("项目目标").fill("验证接续、批准和成果归入");await page.getByRole("button",{name:"创建项目并开始沉淀"}).click();await expect(page).toHaveURL(/\/projects\/(?!new)[^/?#]+$/);
 await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"长期委托"}).click();
 const panel=page.locator("#mission-agent"),goal="跨时间准备10月实验汇报";await panel.getByRole("textbox",{name:"委托目标"}).fill(goal);await panel.getByRole("checkbox",{name:/允许配置的云模型/}).check();
 const created=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");await panel.getByRole("button",{name:"创建委托",exact:true}).click();const{id}=((await(await created).json()) as {mission:{id:string}}).mission;
 await slice(id,{kind:"ask",question:"请补充本项目2026-10的Dice百分比",missing:"PRIVATE",requirements:{terms:[],unit:"",period:"",sourceType:"EITHER",metric:{name:"Dice",unit:"%",period:"2026-10"}}});
 await expect(panel.getByText("请补充本项目2026-10的Dice百分比",{exact:true})).toBeVisible();await page.reload();await panel.getByRole("button",{name:new RegExp(goal+" · 等待补充信息")}).click();await panel.getByText(/执行详情与回执（/).click();await expect(panel.getByText(`任务编号：${id}`,{exact:true})).toBeVisible();
 await panel.getByText("材料到达后的接续许可",{exact:true}).click();await panel.getByRole("button",{name:"授权满足结构化缺口后自动读取与分析",exact:true}).click();await expect(panel.getByRole("button",{name:"撤销自动接续许可",exact:true})).toBeVisible();
 await panel.getByRole("spinbutton",{name:"实验指标数值（%）"}).fill("82");await panel.getByRole("button",{name:"保存本项目实验记录",exact:true}).click();await expect(panel.getByText(/已保存实验记录/)).toBeVisible();await scan(id);
 const state=fixture("state",id);expect(state.status).toBe("READY");expect(state.events.filter(e=>e.type==="AUTO_CONTINUATION_READY")).toHaveLength(1);
 await slice(id,{kind:"tool",tool:"save_mission_output",args:{blocks:[{blockId:"report",kind:"INFERENCE",text:"10月汇报：用户已提供Dice记录，需继续核对实验条件。",sourceIds:[]}]},summary:"更新汇报"});
 await expect(panel.getByRole("heading",{name:"草稿版本 1 · 内容待审核"})).toBeVisible();await slice(id,{kind:"tool",tool:"propose_action",args:{title:"核对实验条件后确认汇报",priority:4},summary:"待批准"});await expect(panel.getByText("将创建本项目 1 项待办：核对实验条件后确认汇报",{exact:true})).toBeVisible();expect(fixture("state",id).actions.filter(a=>a.title==="核对实验条件后确认汇报")).toHaveLength(0);
 await panel.getByRole("button",{name:"批准创建行动",exact:true}).click();await expect.poll(()=>fixture("state",id).approvals.filter(a=>a.status==="APPROVED").length).toBe(1);await slice(id,{kind:"ask",question:"不应在创建片段额外调用模型",missing:"PRIVATE"});await expect(panel.getByRole("link",{name:"已创建行动：核对实验条件后确认汇报"})).toBeVisible();expect(fixture("state",id).actions.filter(a=>a.title==="核对实验条件后确认汇报"&&a.status==="TODO")).toHaveLength(1);
 await panel.getByRole("button",{name:"预览归入项目周报",exact:true}).click();await expect(panel.getByText("归入只保存成果，不确认项目事实。",{exact:true})).toBeVisible();await panel.getByRole("button",{name:"确认保存并向项目成员共享",exact:true}).click();await expect(panel.getByText(/已归入项目周报，成果编号/)).toBeVisible();const receipt=fixture("state",id).receipt!;
 await slice(id,{kind:"finish",outputId:receipt.outputId});await expect(panel.getByText("委托条件已验收",{exact:true}).first()).toBeVisible();
 await page.screenshot({path:"test-results/pre-r4-mission-continuation-adoption.png",fullPage:true,animations:"disabled"});
 const missionPath=new URL(page.url()).pathname;
 await panel.getByRole("link",{name:"打开已归入的成果版本"}).click();
 await expect(page).toHaveURL(new RegExp(`artifact=${receipt.artifactId}`));
 await expect(page.getByRole("article",{name:"Markdown 渲染预览"})).toContainText("10月汇报");
 await page.goto(`${missionPath}?mission=${id}`);await expect(panel.getByText("委托条件已验收",{exact:true}).first()).toBeVisible();
 await panel.getByText("委托新目标",{exact:true}).click();await panel.getByRole("textbox",{name:"委托目标"}).fill("引用已归入成果准备后续汇报");const nextCreated=page.waitForResponse(r=>r.url().endsWith("/api/missions")&&r.request().method()==="POST");await panel.getByRole("button",{name:"创建委托",exact:true}).click();const nextResponse=await nextCreated;expect(nextResponse.status()).toBe(202);const next=(await nextResponse.json()).mission;
 await slice(next.id,{kind:"tool",tool:"search_memory",args:{query:"10月汇报",limit:8},summary:"复用项目成果"});const step=fixture("state",next.id).steps.find(s=>s.toolName==="search_memory")!;expect(step.resultJson?.sources?.some(s=>s.id===`artifact:${receipt.artifactId}`)).toBe(true);
 await openProjectDirectory(page);await page.getByRole("navigation",{name:"项目功能导航"}).getByRole("link",{name:"项目首页",exact:true}).click();
 await page.locator(`a[href$="mission=${next.id}"]`).first().click();
 await expect(page).toHaveURL(new RegExp(`/missions\\?mission=${next.id}`));await panel.getByText(/执行详情与回执（/).click();await expect(page.getByText(`任务编号：${next.id}`,{exact:true})).toBeVisible();
 await page.getByText("项目功能",{exact:true}).click();
 await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"});});
 await page.screenshot({path:"test-results/pre-r4-mission-desktop.png",fullPage:true,animations:"disabled"});
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"});});
 await expect(panel.getByRole("heading",{name:"引用已归入成果准备后续汇报",exact:true})).toBeInViewport();
 await page.screenshot({path:"test-results/pre-r4-mission-mobile.png",fullPage:true,animations:"disabled"});
});
