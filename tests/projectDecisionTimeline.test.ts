// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,cleanup} from "@testing-library/react";
import {it,expect,vi,afterEach} from "vitest";
import {ProjectDecisionTimeline} from "@/components/ProjectDecisionTimeline";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("按需读取真实关系确认与撤销时间，不虚构历史状态回放",async()=>{
 const old={id:"old",title:"原性能目标",summary:"目标值",createdAt:"2026-10-01T00:00:00Z"},next={id:"next",title:"补充实验条件",summary:"新观察",createdAt:"2026-10-02T00:00:00Z"};
 const fetch=vi.fn(async()=>({ok:true,json:async()=>({asOf:"2026-10-22T00:00:00Z",enabled:true,items:[{card:old,statusLabel:"存在冲突",displayReason:"原关系已撤销",supersededBy:null,relations:[{id:"r",relationType:"SUPPORTS",reason:"曾作为支持条件",currentCard:next,relatedCard:old,confirmedAt:"2026-10-03T00:00:00Z",revokedAt:"2026-10-04T00:00:00Z",validFrom:null,validTo:null}]}]})}));
 vi.stubGlobal("fetch",fetch);render(createElement(ProjectDecisionTimeline,{projectId:"p"}));expect(fetch).not.toHaveBeenCalled();
 fireEvent.click(screen.getByRole("button",{name:"查看结论与关系记录"}));
 expect(await screen.findByText(/当前核验：存在冲突/)).toBeTruthy();
 expect(screen.getByText(/确认于.*撤销于/)).toBeTruthy();
 expect(screen.getByRole("link",{name:"补充实验条件"}).getAttribute("href")).toBe("/projects/p/knowledge#card-next");
 expect(fetch).toHaveBeenCalledOnce();expect(screen.queryByRole("slider")).toBeNull();
});
it("读取失败可以重试；401后不残留旧结论",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>({ok:false,status:401,json:async()=>({error:{message:"private"}})})));
 render(createElement(ProjectDecisionTimeline,{projectId:"p"}));fireEvent.click(screen.getByRole("button",{name:"查看结论与关系记录"}));
 expect(await screen.findByText(/请重新登录后查看项目演进/)).toBeTruthy();
 expect(screen.getByRole("button",{name:"重新读取项目演进"})).toBeTruthy();expect(screen.queryByText("private")).toBeNull();
});
