// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MissionResponsibilityPanel } from "@/components/MissionResponsibilityPanel";
import { clearConversationDrafts } from "@/lib/client/conversationDrafts";
afterEach(()=>{cleanup();clearConversationDrafts();vi.unstubAllGlobals();});
const response=(data:unknown,status=200)=>({ok:status===200,status,json:async()=>data});
const initial={schemaVersion:1,missionId:"m",projectId:"p",controlVersion:"v1",goal:"原调查目标",workingObjective:null,
  successCriteria:["DRAFT_EXISTS",{type:"SOURCE_COUNT",minimum:2}],successCriteriaLabels:["草稿已保存","至少核对 2 个来源"],constraints:{deadline:"2026-11-01T12:00:00.000Z",llmContextApproved:true},
  deadline:"2026-11-01T12:00:00.000Z",researchScope:{},continuationPolicy:{mode:"MANUAL"},permissionExpiresAt:null,permissionState:"WITHIN_TIME_BOUNDARY",
  budget:{limits:{models:12,tools:16},cumulativeUsed:{models:1,tools:2,unknownCalls:0},policy:"CUMULATIVE",monetaryCost:null},
  workState:{phase:"READY"},workerPresence:"UNOBSERVED",nextCheckAt:null,activity:[]};
test("责任修订丢回包、轮询变版与重挂载后，仍重放同一请求完整载荷",async()=>{
  const calls:unknown[]=[], changed=vi.fn();let snapshot=initial;
  vi.stubGlobal("fetch",vi.fn(async(_url:string,options?:RequestInit)=>{
    if(options?.method==="PATCH"){
      calls.push(JSON.parse(String(options.body)));
      if(calls.length===1){snapshot={...initial,controlVersion:"v2",constraints:{...initial.constraints,deadline:"2026-11-02T12:00:00.000Z"}};throw new Error("回包丢失");}
      return response({responsibility:snapshot});
    }
    return response({responsibility:snapshot});
  }));
  const first=render(createElement(MissionResponsibilityPanel,{missionId:"m",onRevised:changed}));
  fireEvent.click(await screen.findByText("委托范围与累计用量"));
  fireEvent.click(await screen.findByRole("button",{name:"修订责任范围"}));
  const inputs=screen.getAllByRole("textbox");fireEvent.change(inputs[0],{target:{value:"本次明确的新目标"}});
  fireEvent.click(screen.getByRole("button",{name:"确认修订（失效原有提案）"}));
  await screen.findByText("回包丢失");first.unmount();
  render(createElement(MissionResponsibilityPanel,{missionId:"m",onRevised:changed}));
  const retry=await screen.findByRole("button",{name:"核对上次提交结果"});
  fireEvent.click(retry);await waitFor(()=>expect(changed).toHaveBeenCalledTimes(1));
  expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
  expect(calls[0]).toMatchObject({goal:"本次明确的新目标",expectedControlVersion:"v1",constraints:{deadline:initial.deadline}});
});


test("默认收起管理合同，但后台状态和实际下次核对时间保持可见",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>response({responsibility:{...initial,nextCheckAt:"2026-11-01T10:00:00.000Z"}})));
 render(createElement(MissionResponsibilityPanel,{missionId:"m",onRevised:()=>{}}));
 await screen.findByText("尚未观测到后台");
 expect(screen.getByText(/下次计划核对/)).toBeTruthy();
 const summary=screen.getByText("委托范围与累计用量");
 expect(summary.closest("details")?.open).toBe(false);
 fireEvent.click(summary);
 expect(summary.closest("details")?.open).toBe(true);
 expect(screen.getByRole("button",{name:"修订责任范围"})).toBeTruthy();
});
