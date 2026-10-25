// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {MissionContinuation} from "@/components/MissionContinuation";
import type {FitPremise} from "@/lib/types/missionEvidenceFit";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function fixture(fail=false){
 const calls:Array<{url:string;body:unknown}>=[],resumed=vi.fn(async()=>undefined),pointer={id:"capture:source",hash:"a".repeat(64)};
 vi.stubGlobal("fetch",vi.fn(async(url:string,init?:RequestInit)=>{const body=init?.body?JSON.parse(init.body as string):undefined;calls.push({url,body});const value=url.endsWith("/preview")?{assessmentHash:"frozen",assessment:"SUFFICIENT",remaining:[],materials:[{id:pointer.id,text:"本地实验Dice82%"}]}:url.endsWith("/confirm")?fail?{error:{message:"材料已变化，请重新预览"}}:{continued:true}:{candidates:[{sourcePointer:pointer,readable:true,excerpt:"本地实验Dice82%",observedAt:"2026-10-20T00:00:00Z"}]};return{ok:!(fail&&url.endsWith("/confirm")),json:async()=>value};}));
 render(createElement(MissionContinuation,{id:"m",questionId:"q",version:7,contextVersion:3,onContinued:resumed}));return{calls,resumed,pointer};
}
async function confirm(){fireEvent.click((await screen.findAllByRole("checkbox"))[0]);fireEvent.click(screen.getByRole("button",{name:"评估选中材料"}));await screen.findByText("材料字段齐备，仍需您核对含义");const button=screen.getByRole("button",{name:"确认材料并继续委托"}) as HTMLButtonElement;expect(button.disabled).toBe(true);fireEvent.change(screen.getByRole("textbox",{name:"材料说明与当前问题答复"}),{target:{value:"确认来自本地实验，请继续修订"}});fireEvent.click(screen.getByRole("checkbox",{name:"我已核对材料与该问题的关系，确认以上答复"}));fireEvent.click(button);}
describe("材料接续面板",()=>{
 it("新版普通答复保留未知用途；问题条件换版必须重新勾选",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({candidates:[]})})));
  const premise:FitPremise={schemaVersion:1,domain:"TECH_RESOURCE_MEASUREMENT",questionId:"q",goalHash:"g",constraintsVersion:1,scopeVersion:1,premiseHash:"a".repeat(64),basisStatus:"GROUNDED",measurement:{name:"GPU_MEMORY",unit:"GB",upperLimit:6},checks:[{id:"SUBJECT",expected:"模型A",basis:{kind:"QUESTION",quote:"模型A"}},{id:"STAGE",expected:"推理",basis:{kind:"QUESTION",quote:"推理"}}]};
  const answer=vi.fn(async()=>undefined),props={id:"m",questionId:"q",version:7,contextVersion:3,onAnswer:answer,onContinued:async()=>undefined,evidencePremise:premise};
  const {rerender}=render(createElement(MissionContinuation,props));
  fireEvent.change(screen.getByRole("textbox",{name:"补充信息"}),{target:{value:"还不知道设备条件，先保留未知分析"}});
  const button=screen.getByRole("button",{name:"补充并继续"}) as HTMLButtonElement;expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对以上条件与原问题的关系"}));expect(button.disabled).toBe(false);
  rerender(createElement(MissionContinuation,{...props,version:8,evidencePremise:{...premise,premiseHash:"b".repeat(64)}}));
  expect((screen.getByRole("checkbox",{name:"我已核对以上条件与原问题的关系"}) as HTMLInputElement).checked).toBe(false);
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox",{name:"我已核对以上条件与原问题的关系"}));fireEvent.click(button);
  await waitFor(()=>expect(answer).toHaveBeenCalledWith("还不知道设备条件，先保留未知分析",expect.objectContaining({mode:"CONDITIONAL_ANALYSIS",premiseHash:"b".repeat(64)})));
 });
 it("材料已关联但继续等待时仍刷新同任务回执",async()=>{
  const f=fixture();
  const original=globalThis.fetch;
  vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>String(input).endsWith("/confirm")
   ?new Response(JSON.stringify({continued:false,reason:"INSUFFICIENT"}),{status:200})
   :original(input,init)));
  await confirm();
  await screen.findByText("委托继续等待：尚缺必要信息");
  expect(f.resumed).toHaveBeenCalledTimes(1);
 });
 it("同问题版本更新保留答复但不能使用旧预览",async()=>{
  fixture();
  const value="确认来自本地实验，请继续修订";
  // 更改同一组件的服务端版本，模拟父面板轮询；不重新创建问题。
  cleanup();
  const resumed=vi.fn(async()=>undefined),props={id:"m",questionId:"q",version:7,contextVersion:3,onContinued:resumed};
  const {rerender}=render(createElement(MissionContinuation,props));
  fireEvent.click((await screen.findAllByRole("checkbox"))[0]);fireEvent.click(screen.getByRole("button",{name:"评估选中材料"}));await screen.findByText("材料字段齐备，仍需您核对含义");
  fireEvent.change(screen.getByRole("textbox",{name:"材料说明与当前问题答复"}),{target:{value}});
  rerender(createElement(MissionContinuation,{...props,version:8,contextVersion:4}));
  expect((screen.getByRole("textbox",{name:"材料说明与当前问题答复"}) as HTMLTextAreaElement).value).toBe(value);
  expect(screen.queryByRole("button",{name:"确认材料并继续委托"})).toBeNull();expect(screen.getByText(/委托版本已变化/)).toBeTruthy();
 });
 it("先展示评估再人工确认，提交冻结的版本与资料指针",async()=>{const f=fixture();await confirm();await waitFor(()=>expect(f.resumed).toHaveBeenCalledTimes(1));expect(f.calls.find(c=>c.url.endsWith("/confirm"))?.body).toMatchObject({questionId:"q",expectedVersion:7,expectedContextVersion:3,assessmentHash:"frozen",sourcePointers:[f.pointer],confirmedGap:true});});
 it("旧预览409留在当前问题并提示重新预览",async()=>{const f=fixture(true);await confirm();await screen.findByRole("alert");expect(screen.getByText("材料已变化，请重新预览")).toBeTruthy();expect(f.resumed).not.toHaveBeenCalled();expect(screen.queryByRole("button",{name:"确认材料并继续委托"})).toBeNull();});
 it("保存返回的sourceId自动定位该资料并预填可编辑答复",async()=>{
  const pointer={id:"capture:returned",hash:"b".repeat(64)},calls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{calls.push(url);
   if(url.includes("sourceId="))return{ok:true,json:async()=>({candidates:[{sourcePointer:pointer,readable:true,excerpt:"10月显存6.2GB",observedAt:"2026-10-20T00:00:00Z",title:"新记录"}],coverage:{truncated:false}})};
   if(url.endsWith("/preview"))return{ok:true,json:async()=>({assessmentHash:"frozen",assessment:"SUFFICIENT",remaining:[],materials:[{id:pointer.id,text:"10月显存6.2GB"}]})};
   return{ok:true,json:async()=>({continued:true})};}));
  render(createElement(MissionContinuation,{id:"m",questionId:"q",version:7,contextVersion:3,onContinued:async()=>undefined,initialSourceId:pointer.id}));
  expect((await screen.findAllByRole("checkbox"))[0] as HTMLInputElement).toBeTruthy();
  expect((screen.getAllByRole("checkbox")[0] as HTMLInputElement).checked).toBe(true);
  expect(new URL(calls[0],"https://x").searchParams.get("sourceId")).toBe(pointer.id);
  const text=screen.getByRole("textbox",{name:"材料说明与当前问题答复"}) as HTMLTextAreaElement;
  expect(text.value).toContain("6.2GB");
  fireEvent.change(text,{target:{value:"我核对过这份记录，请继续"}});
  expect((screen.getByRole("textbox",{name:"材料说明与当前问题答复"}) as HTMLTextAreaElement).value).toBe("我核对过这份记录，请继续");
 });
 it("问题切换后迟到的定向读取响应不进入新问题",async()=>{
  const pointer={id:"capture:late",hash:"c".repeat(64)};
  let release:(value:unknown)=>void=()=>{};const gate=new Promise(value=>{release=value;});
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>{
   if(url.includes("questionId=q1")){await gate;return{ok:true,json:async()=>({candidates:[{sourcePointer:pointer,readable:true,excerpt:"旧问题的迟到资料",observedAt:"2026-10-20T00:00:00Z"}]})};}
   return{ok:true,json:async()=>({candidates:[]})};}));
  const props={id:"m",questionId:"q1",version:7,contextVersion:3,onContinued:async()=>undefined,initialSourceId:pointer.id};
  const {rerender}=render(createElement(MissionContinuation,props));
  rerender(createElement(MissionContinuation,{...props,questionId:"q2"}));
  release(null);await new Promise(resolve=>setTimeout(resolve,0));
  expect(screen.queryByText("旧问题的迟到资料")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
 });
 it("身份失效清空私有选择与答复并停止操作",async()=>{
  const pointer={id:"capture:mine",hash:"d".repeat(64)};
  vi.stubGlobal("fetch",vi.fn(async(url:string)=>url.includes("sourceId=")
   ?{ok:false,status:401,json:async()=>({error:{message:"请先登录"}})}
   :{ok:true,json:async()=>({candidates:[]})}));
  render(createElement(MissionContinuation,{id:"m",questionId:"q",version:7,contextVersion:3,onContinued:async()=>undefined,initialSourceId:pointer.id}));
  await screen.findByRole("alert");
  expect(screen.getByText("请先登录")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button",{name:"评估选中材料"})).toBeNull();
 });
});
