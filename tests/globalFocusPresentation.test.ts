import { expect, it } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { missionStatusLabels } from "@/lib/mission/presentation";
import {selectProjectAgentContext} from "@/lib/projectAgentContext";
import type {GlobalFocus,FocusEntry} from "@/lib/types/globalFocus";
const native: { focusStatusLabel: (status: string) => string; focusActionLabel: (status: string, kind: string) => string;focusPrimary:(view:GlobalFocus)=>FocusEntry|null;focusEntryKind:(view:GlobalFocus,item:FocusEntry)=>string } = {} as typeof native;
const source = fs.readFileSync("harmonyos/entry/src/main/ets/common/GlobalFocusPresentation.ets", "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext("(function(exports){" + code + "})", {})(native);
it.each(["WAITING_INPUT", "WAITING_APPROVAL", "PAUSED", "FAILED", "READY", "RUNNING"])("双端焦点的%s语义一致", status => {
  expect(native.focusStatusLabel(status)).toBe(missionStatusLabels[status]);
});
it("审批、补料、暂停与失败进入各自原流程，不能通用地显示完成", () => {
  expect(native.focusActionLabel("WAITING_INPUT", "mission")).toBe("补充委托资料 →");
  expect(native.focusActionLabel("WAITING_APPROVAL", "mission")).toBe("审阅待批准提案 →");
  expect(native.focusActionLabel("PAUSED", "mission")).toBe("查看暂停原因 →");
  expect(native.focusActionLabel("FAILED", "mission")).toBe("查看失败原因 →");
  expect(native.focusActionLabel("RUNNING", "mission")).toBe("查看委托进展 →");
});
it("ArkTS优先读服务端统一目标，保留同一Mission、状态和理由",()=>{
  const context=selectProjectAgentContext({projectId:"p",projectTitle:"研究",projectGoal:"总目标",projectUpdatedAt:"2026-10-23",candidates:[{kind:"MISSION",id:"original",status:"WAITING_INPUT",title:"整理成果",reason:"补充对照实验",updatedAt:"2026-10-23",questionId:"question",version:2,planRevision:1}]});
  const view:GlobalFocus={primaryContext:context,counts:{waiting:1,running:0,actions:0,reminders:0},nextDeadline:null,schemaVersion:1,missionEnabled:true,archived:false,hasMore:false,waiting:[],running:[],actions:[],reminders:[],records:[]};
  const item=native.focusPrimary(view)!;expect(item).toMatchObject({id:"original",projectId:"p",status:"WAITING_INPUT",detail:context.nextStep.reason});expect(native.focusEntryKind(view,item)).toBe("mission");
});
