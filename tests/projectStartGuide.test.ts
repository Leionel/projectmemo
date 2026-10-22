// @vitest-environment jsdom
import {render,screen,cleanup} from "@testing-library/react";
import {afterEach,it,expect} from "vitest";
import {ProjectStartGuide} from "@/components/ProjectStartGuide";
import {createElement} from "react";
afterEach(cleanup);
it("空项目与资料尚未沉淀的情况不同，不将已有Capture误当卡片",()=>{
 const {rerender}=render(createElement(ProjectStartGuide,{projectId:"p",hasCards:false,hasRecords:false,missionsEnabled:true,hasActiveMission:false,stateEnabled:false}));
 expect(screen.getByText("留下真实资料")).toBeTruthy();
 rerender(createElement(ProjectStartGuide,{projectId:"p",hasCards:false,hasRecords:true,missionsEnabled:false,hasActiveMission:false,stateEnabled:false}));
 expect(screen.getByText("资料已记录，核对处理结果")).toBeTruthy();
 expect(screen.queryByRole("link",{name:"填写委托目标"})).toBeNull();
});
it("已有资料跳过初次说明；正在委托时不给重复引导",()=>{
 const {rerender}=render(createElement(ProjectStartGuide,{projectId:"p",hasCards:true,hasRecords:true,missionsEnabled:true,hasActiveMission:false,stateEnabled:true}));
 expect(screen.getByRole("link",{name:"查看当前项目判断"}).getAttribute("href")).toBe("/projects/p/health#project-state");
 expect(screen.queryByText("如何从第一条资料推进项目")).toBeNull();
 rerender(createElement(ProjectStartGuide,{projectId:"p",hasCards:true,hasRecords:true,missionsEnabled:true,hasActiveMission:true,stateEnabled:true}));
 expect(screen.queryByRole("region")).toBeNull();
});
