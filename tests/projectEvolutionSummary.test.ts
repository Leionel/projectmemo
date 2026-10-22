// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,it,expect,vi} from "vitest";
import {ProjectEvolutionSummary} from "@/components/ProjectEvolutionSummary";
vi.mock("@/lib/client/deviceKey",()=>({getDeviceKey:()=>"test-consumer"}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("没有基线时不虚构离开后的变化，也不刷新或确认快照",async()=>{
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({snapshot:{id:"s",evaluatedAt:"2026-10-01T00:00:00Z"},lastSeenSnapshotId:null})}));
 vi.stubGlobal("fetch",fetch);render(createElement(ProjectEvolutionSummary,{projectId:"p"}));
 expect(await screen.findByText(/尚无已了解的比较基线/)).toBeTruthy();expect(fetch).toHaveBeenCalledTimes(1);
 expect(fetch.mock.calls[0]).toEqual(["/api/projects/p/state?consumerKey=test-consumer"]);expect(screen.queryByText(/自上次查看/)).toBeNull();
});
it("仅比较服务提供的真实快照ID，直接展示已有差异",async()=>{
 const requests:string[]=[];vi.stubGlobal("fetch",vi.fn(async(url:string)=>{requests.push(url);return{ok:true,json:async()=>url.includes("/diff?")?{diff:{fromSnapshotId:"old",toSnapshotId:"new",items:[{changeKey:"c",summary:"记录被取代",before:"旧条件",after:"新条件"}]}}:{snapshot:{id:"new",evaluatedAt:"2026-10-01T00:00:00Z"},lastSeenSnapshotId:"old"}};}));
 render(createElement(ProjectEvolutionSummary,{projectId:"p"}));expect(await screen.findByText("记录被取代")).toBeTruthy();expect(requests[1]).toContain("from=old&to=new");expect(requests).toHaveLength(2);
});
it("Diff故障保留已读取快照，不误报无变化；401则清空观察",async()=>{
 let denied=false;vi.stubGlobal("fetch",vi.fn(async(url:string)=>({ok:!url.includes("/diff?"),status:denied?401:503,json:async()=>url.includes("/diff?")?{error:{message:"internal"}}:{snapshot:{id:"new",evaluatedAt:"2026-10-01T00:00:00Z"},lastSeenSnapshotId:"old"}})));
 render(createElement(ProjectEvolutionSummary,{projectId:"p"}));expect(await screen.findByText(/差异暂未加载；不能据此判断没有变化/)).toBeTruthy();
 expect(screen.getByText(/观察于/)).toBeTruthy();expect(screen.queryByText(/当前已了解这份快照/)).toBeNull();
 denied=true;const {fireEvent}=await import("@testing-library/react");fireEvent.click(screen.getByRole("button",{name:"重新读取项目观察"}));
 expect(await screen.findByText(/请重新登录或核对项目权限/)).toBeTruthy();expect(screen.queryByText(/观察于/)).toBeNull();
});
