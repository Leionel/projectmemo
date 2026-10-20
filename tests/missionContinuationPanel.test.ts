// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {MissionContinuation} from "@/components/MissionContinuation";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fixture(fail=false){
 const calls:Array<{url:string;body:unknown}>=[],resumed=vi.fn(async()=>undefined),pointer={id:"capture:source",hash:"a".repeat(64)};
 vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):undefined;calls.push({url,body});const value=url.endsWith("/preview")?{assessmentHash:"frozen",assessment:"SUFFICIENT",remaining:[],materials:[{id:pointer.id,text:"本地实验Dice82%"}]}:url.endsWith("/confirm")?fail?{error:{message:"材料已变化，请重新预览"}}:{continued:true}:{candidates:[{sourcePointer:pointer,readable:true,excerpt:"本地实验Dice82%",observedAt:"2026-10-20T00:00:00Z"}]};return{ok:!(fail&&url.endsWith("/confirm")),json:async()=>value};}));
 render(createElement(MissionContinuation,{id:"m",questionId:"q",version:7,contextVersion:3,onContinued:resumed}));return{calls,resumed,pointer};
}
async function confirm(){fireEvent.click((await screen.findAllByRole("checkbox"))[0]);fireEvent.click(screen.getByRole("button",{name:"评估选中材料"}));await screen.findByText("材料字段齐备，仍需您核对含义");const button=screen.getByRole("button",{name:"确认材料并继续委托"}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.change(screen.getByRole("textbox",{name:"材料说明与当前问题答复"}),{target:{value:"确认来自本地实验，请继续修订"}});fireEvent.click(screen.getByRole("checkbox",{name:"我已核对材料与该问题的关系，确认以上答复"}));fireEvent.click(button);}
describe("材料接续面板",()=>{
 it("先展示评估再人工确认，提交冻结的版本与资料指针",async()=>{const f=fixture();await confirm();await waitFor(()=>expect(f.resumed).toHaveBeenCalledTimes(1));expect(f.calls.find(c=>c.url.endsWith("/confirm"))?.body).toMatchObject({questionId:"q",expectedVersion:7,expectedContextVersion:3,assessmentHash:"frozen",sourcePointers:[f.pointer],confirmedGap:true});});
 it("旧预览409留在当前问题并提示重新预览",async()=>{const f=fixture(true);await confirm();await screen.findByRole("alert");expect(screen.getByText("材料已变化，请重新预览")).toBeTruthy();expect(f.resumed).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"确认材料并继续委托"})).toBeNull();});
});
