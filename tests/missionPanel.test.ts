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
 it("模板写入真实只读约束但不代勾云模型许可；丢失响应先读回并保留请求编号",async()=>{
  fixture();const original=globalThis.fetch;const requests:Array<{requestId:string;missionConstraints:unknown;llmContextApproved:boolean}>=[];
  vi.stubGlobal("fetch",vi.fn(async(input,init)=>{if(input==="/api/missions"&&init?.method==="POST"){requests.push(JSON.parse(init.body as string));throw new Error("response lost");}return original(input,init);}));
  render(createElement(MissionPanel,{projectId:"p"}));fireEvent.click(screen.getByRole("button",{name:"使用阶段汇报模板"}));
  expect((screen.getByRole("checkbox",{name:/允许配置的云模型/}) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole("checkbox",{name:"仅允许读取、分析和保存草稿"}) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("button",{name:"创建委托"}));expect(await screen.findByText(/已读取最新状态/)).toBeTruthy();
  expect((screen.getByRole("textbox",{name:"委托目标"}) as HTMLTextAreaElement).value).toContain("本次只读取");
  fireEvent.click(screen.getByRole("button",{name:"创建委托"}));await waitFor(()=>expect(requests).toHaveLength(2));
  expect(requests[0].requestId).toBe(requests[1].requestId);expect(requests[0].missionConstraints).toEqual({executionBoundary:"READ_ANALYZE"});expect(requests[0].llmContextApproved).toBe(false);
 });
 it("过期批准保留内容但不允许再次提交，提示重新预览",async()=>{
  const f=fixture(true);f.mission.approvals[0].expiresAt="2020-01-01T00:00:00Z";
  render(createElement(MissionPanel,{projectId:"p"}));fireEvent.click(await screen.findByRole("button",{name:"整理阶段汇报 · 等待你的批准"}));
  expect(await screen.findByText("提案已过期，请更新依据并重新预览。")).toBeTruthy();expect((screen.getByRole("button",{name:"批准创建行动"}) as HTMLButtonElement).disabled).toBe(true);expect(f.requests).toHaveLength(0);
 });
 it("401时清除已显示的私有委托、来源和输入，不留下旧账号内容",async()=>{
  fixture();render(createElement(MissionPanel,{projectId:"p"}));const row=await screen.findByRole("button",{name:"整理阶段汇报 · 等待执行"});fireEvent.click(row);await screen.findByRole("heading",{name:"整理阶段汇报"});
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:401,json:async()=>({error:{message:"登录已过期"}})})));
  fireEvent.click(row);await screen.findByRole("alert");await waitFor(()=>expect(screen.queryByRole("heading",{name:"整理阶段汇报"})).toBeNull());expect(screen.queryByRole("button",{name:"整理阶段汇报 · 等待执行"})).toBeNull();
 });
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
