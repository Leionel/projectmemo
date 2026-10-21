// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {MissionPanel} from "@/components/MissionPanel";
import {constraintsSchema,researchScopeSchema} from "@/lib/types/mission";
const {emit}=vi.hoisted(()=>({emit:vi.fn()}));
vi.mock("@/lib/client/workspaceEvents",()=>({emitWorkspaceChange:emit}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();emit.mockReset();});
function fixture(action=false){
 const mission={id:"m",projectId:"p",goal:"整理阶段汇报",status:action?"WAITING_APPROVAL":"READY",version:1,constraintsVersion:1,researchScopeVersion:1,constraints:{...constraintsSchema.parse({}),llmContextApproved:false},researchScope:researchScopeSchema.parse({}),question:null,error:null,pauseReason:null,outputs:[],steps:action?[{id:"s",toolName:"propose_action",status:"SUCCEEDED",result:{data:{actionId:"a",title:"核对实验条件",status:"TODO"}}}]:[],approvals:action?[{id:"approval",proposalHash:"hash",proposal:{args:{title:"下一项验证",description:"验证公开条件",priority:4,dueAt:"2026-10-30T18:00:00.000Z"}},expiresAt:"2026-10-30T19:00:00.000Z"}]:[]};
 const requests:Array<{url:string;body:unknown}>=[];
 vi.stubGlobal("fetch",vi.fn(async(raw:string,init?:RequestInit)=>{if(init?.body)requests.push({url:raw,body:JSON.parse(init.body as string)});const data=raw.includes("/sources")?{sources:[]}:raw.includes("?projectId=")?{missions:[mission]}:{mission};return{ok:true,json:async()=>data};}));
 return{requests,mission};
}
describe("Mission 面板调用方",()=>{
 it("暂停时展示具体协议原因和继续入口，旧通用错误也能读懂",async()=>{
  const f=fixture();Object.assign(f.mission,{status:"PAUSED",error:{code:"MODEL_PROTOCOL_ERROR",message:"委托执行失败，请检查服务配置后继续"}});
  render(createElement(MissionPanel,{projectId:"p"}));
  const row=await screen.findByRole("button",{name:"整理阶段汇报 · 已暂停"});fireEvent.click(row);
  const alert=await screen.findByRole("alert");expect(alert.textContent).toContain("模型回复格式不符合要求");expect(alert.textContent).toContain("已有进度已保留");
  fireEvent.click(screen.getByText("暂停、取消与恢复操作"));
  expect(screen.getByRole("button",{name:"继续"})).toBeTruthy();expect(row.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByText(/执行详情与回执（/));
  expect(screen.getByRole("region",{name:"执行记录"})).toBeTruthy();
 });
 it("创建失败保留用户目标和云模型选择，给出可重试提示",async()=>{
  fixture();const original=globalThis.fetch;
  vi.stubGlobal("fetch",vi.fn(async(input,init)=>init?.method==="POST"?{ok:false,json:async()=>({error:{message:"服务暂时不可用"}})}:original(input,init)));
  render(createElement(MissionPanel,{projectId:"p"}));const goal=screen.getByRole("textbox",{name:"委托目标"});
  fireEvent.change(goal,{target:{value:"请准备有来源的阶段汇报"}});const consent=screen.getByRole("checkbox",{name:/允许配置的云模型/});fireEvent.click(consent);
  fireEvent.click(screen.getByRole("button",{name:"创建委托"}));await screen.findByRole("alert");
  expect((goal as HTMLTextAreaElement).value).toBe("请准备有来源的阶段汇报");expect((consent as HTMLInputElement).checked).toBe(true);
  expect(screen.getByRole("button",{name:"刷新重试"})).toBeTruthy();
 });
 it("自动接续许可由用户显式提交，包含当前版本",async()=>{const f=fixture();render(createElement(MissionPanel,{projectId:"p"}));fireEvent.click(await screen.findByRole("button",{name:"整理阶段汇报 · 等待执行"}));await screen.findByRole("heading",{name:"整理阶段汇报"});fireEvent.click(screen.getByText("材料到达后的接续许可"));fireEvent.click(screen.getByRole("button",{name:"授权满足结构化缺口后自动读取与分析"}));await waitFor(()=>expect(f.requests.find(r=>r.url.endsWith("/continuation-policy"))?.body).toMatchObject({expectedVersion:1,policy:{mode:"LOW_RISK_READ_ANALYZE"}}));});
 it("多行约束和多个公开概念完整提交，不在逐键编辑时丢分隔符",async()=>{const f=fixture();render(createElement(MissionPanel,{projectId:"p"}));fireEvent.click(await screen.findByRole("button",{name:"整理阶段汇报 · 等待执行"}));await screen.findByRole("heading",{name:"整理阶段汇报"});fireEvent.click(screen.getByText("查看或修改个人约束"));fireEvent.change(screen.getByRole("textbox",{name:"资源限制（每行一项）"}),{target:{value:"仅用CPU\n公开数据集"}});fireEvent.click(screen.getByRole("button",{name:"确认保存约束与许可"}));await waitFor(()=>expect(f.requests.find(r=>r.url.endsWith("/constraints"))?.body).toMatchObject({constraints:{resourceLimits:["仅用CPU","公开数据集"]}}));fireEvent.click(screen.getByText("公开研究范围"));fireEvent.click(screen.getByRole("checkbox",{name:"允许在以下公开范围自主研究"}));fireEvent.change(screen.getByRole("textbox",{name:"公开研究主题"}),{target:{value:"公开分割评测"}});fireEvent.change(screen.getByRole("textbox",{name:"公开概念（逗号分隔）"}),{target:{value:"分割,segmentation"}});fireEvent.click(screen.getByRole("button",{name:"确认研究范围"}));await waitFor(()=>expect(f.requests.find(r=>r.url.endsWith("/research-scope"))?.body).toMatchObject({scope:{publicTerms:["分割","segmentation"],enabled:true}}));});
 it("批准展示完整参数；行动回执可定位，重复读取不反复刷新行动板",async()=>{fixture(true);render(createElement(MissionPanel,{projectId:"p"}));const select=await screen.findByRole("button",{name:"整理阶段汇报 · 等待你的批准"});fireEvent.click(select);await screen.findByText(/优先级：4/);fireEvent.click(screen.getByText(/执行详情与回执（/));expect(screen.getByText(/截止时间：/)).toBeTruthy();expect(screen.getByText(/批准有效至：/)).toBeTruthy();const link=screen.getByRole("link",{name:"已创建行动：核对实验条件"});expect(link.getAttribute("href")).toBe("/projects/p/actions#action-a");await waitFor(()=>expect(emit).toHaveBeenCalledWith("p",["actions"]));fireEvent.click(select);await waitFor(()=>expect(screen.getByRole("link",{name:"已创建行动：核对实验条件"})).toBeTruthy());expect(emit).toHaveBeenCalledTimes(1);});
});
