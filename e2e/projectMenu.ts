import type {Page} from "@playwright/test";
export async function openProjectDirectory(page:Page){
 const summary=page.getByText("项目功能",{exact:true});
 await summary.waitFor({state:"visible"});
 if(await summary.locator("..").getAttribute("open")===null)await summary.click();
}
