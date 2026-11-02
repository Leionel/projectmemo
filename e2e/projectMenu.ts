import type {Page} from "@playwright/test";
export async function openProjectDirectory(page:Page){
 const summary=page.getByText("项目功能",{exact:true});
 await summary.waitFor({state:"visible"});
 if(await summary.locator("..").getAttribute("open")===null)await summary.click();
}
/**
 * 正常入口现在是“材料优先”。已经有明确目标的用户仍然走同一页面的手工表单，
 * 只是折叠在原处；创建字段与提交身份没有变化。
 * 这里把“展开并只在这个表单里填写”固化为共享步骤，避免重名标签命中材料表单。
 */
export async function fillManualProjectForm(page:Page,input:{title:string;description:string;goal:string}){
 await page.getByText("已经有明确目标，直接填写",{exact:true}).click();
 const form=page.locator("details").last();
 await form.getByLabel("项目名称").fill(input.title);
 await form.getByLabel("项目描述").fill(input.description);
 await form.getByLabel("项目目标").fill(input.goal);
 await form.getByRole("button",{name:"创建项目并开始沉淀"}).click();
}
