// @vitest-environment jsdom
import {afterEach,expect,it,vi} from "vitest";
import {createElement} from "react";
import {render,fireEvent,screen,waitFor,cleanup} from "@testing-library/react";
import {ConversationContinuity} from "@/components/ConversationContinuity";
import {clearConversationDrafts} from "@/lib/client/conversationDrafts";
import type {ConversationView} from "@/lib/types/conversation";
afterEach(()=>{cleanup();clearConversationDrafts();vi.unstubAllGlobals();});
it("指引回包丢失后关闭重开，保留原话并重放同一commandId和expectedSeq",async()=>{
  const view={id:"ux1-draft",homeProjectId:"p",focusProjectId:"p",continuity:{seq:0,directives:[],workingObjective:null,stopped:false}} as unknown as ConversationView;
  const calls:unknown[]=[];
  const change=vi.fn(),error=vi.fn();
  vi.stubGlobal("fetch",vi.fn(async(_url:string,options?:RequestInit)=>{
    if(options?.method==="POST"){calls.push(JSON.parse(String(options.body)));if(calls.length===1)throw new Error("connection lost");
      return {ok:true,status:200,json:async()=>({events:["original-event"],admission:{status:"DIRECT_APPLIED"}})};}
    return {ok:true,status:200,json:async()=>view};
  }));
  const props={view,onChange:change,onError:error,onWork:vi.fn()};
  const first=render(createElement(ConversationContinuity,props));
  fireEvent.click(screen.getByRole("button",{name:"调整当前方向"}));
  fireEvent.change(screen.getByRole("textbox",{name:"更正当前工作方向"}),{target:{value:"本周先稳演示，先别加功能"}});
  fireEvent.click(screen.getByRole("button",{name:"按这句话调整"}));
  await waitFor(()=>expect(error).toHaveBeenCalled());
  first.unmount();
  render(createElement(ConversationContinuity,{...props,view:{...view,continuity:{...view.continuity!,seq:1}}}));
  fireEvent.click(screen.getByRole("button",{name:"调整当前方向"}));
  expect((screen.getByRole("textbox",{name:"更正当前工作方向"}) as HTMLInputElement).value).toContain("稳演示");
  fireEvent.click(screen.getByRole("button",{name:"按这句话调整"}));
  await waitFor(()=>expect(change).toHaveBeenCalled());
  expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);
});
