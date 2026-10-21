// @vitest-environment jsdom
import {createElement} from "react";
import {render,screen,fireEvent,waitFor,cleanup} from "@testing-library/react";
import {describe,it,expect,vi,afterEach} from "vitest";
import {MissionMetricInput} from "@/components/MissionMetricInput";
import {MissionClaimChecks} from "@/components/MissionClaimChecks";
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("Target界面契约",()=>{
 it("实验数值走已有Capture接口，结构字段不要求用户输入JSON",async()=>{const calls:Array<{url:string;body:unknown}>=[];vi.stubGlobal("fetch",vi.fn(async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return{ok:true,json:async()=>({card:{id:"c"}})};}));render(createElement(MissionMetricInput,{projectId:"p",name:"Dice",unit:"%",period:"2026-10"}));fireEvent.change(screen.getByRole("spinbutton",{name:"实验指标数值（%）"}),{target:{value:"82.3"}});fireEvent.click(screen.getByRole("button",{name:"保存本项目实验记录"}));await screen.findByText(/已保存实验记录/);expect(calls[0].url).toBe("/api/projects/p/captures");expect(JSON.parse((calls[0].body as {rawText:string}).rawText)).toMatchObject({kind:"PROJECT_METRIC",projectId:"p",name:"Dice",unit:"%",period:"2026-10",value:82.3,subject:"LOCAL_EXPERIMENT"});});
 it("核验关闭不显示支持；开启区分矛盾/不足/未检查，不声称确认事实",async()=>{const checks=[{blockId:"a",status:"ENTAILS",mode:"JUDGE"},{blockId:"b",status:"CONTRADICTS",mode:"RULE"},{blockId:"c",status:"NOT_ENOUGH_INFORMATION",mode:"JUDGE"},{blockId:"d",status:"NOT_CHECKED",mode:"OFF"}];const rendered=render(createElement(MissionClaimChecks,{checks,enabled:false}));expect(screen.queryByText(/证据支持/)).toBeNull();expect(screen.getByText(/语义核验未启用/)).toBeTruthy();rendered.rerender(createElement(MissionClaimChecks,{checks,enabled:true}));fireEvent.click(screen.getByText("逐块核验记录"));await waitFor(()=>expect(screen.getByText(/a · 证据支持该句/)).toBeTruthy());expect(screen.getByText(/b · 与引用证据矛盾/)).toBeTruthy();expect(screen.getByText(/c · 证据不足/)).toBeTruthy();expect(screen.getByText(/不确认项目事实或现实效果/)).toBeTruthy();});
});
