import {expect,it} from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {missionWorkState} from "@/lib/mission/workState";
import {focusPrimary} from "@/lib/client/focusPresentation";
import {selectProjectAgentContext} from "@/lib/projectAgentContext";
import type {GlobalFocus,FocusEntry} from "@/lib/types/globalFocus";
const now=new Date("2026-10-30T04:00:00Z");
const base={id:"original",version:3,status:"WAITING_INPUT"};
const policy={mode:"BOUNDED_INVESTIGATION",expiresAt:"2026-10-31T04:00:00Z"};
it("已解决的旧问题不阻挡观察，也不要求用户重复回答",()=>{
  const w=missionWorkState({...base,waitStateJson:{resolved:true,waitingFor:"OBSERVATION"},continuationPolicyJson:policy,events:[{id:"old",type:"QUESTION",payloadJson:{question:"旧问题"}}]},now);
  expect(w).toMatchObject({phase:"WAITING_OBSERVATION",nextActor:"AGENT",requiresUser:false,exactQuestionRef:null});
});
it("旧记录无明确等待原因时保持未知，真实未解决问题精确绑定",()=>{
  expect(missionWorkState(base,now)).toMatchObject({phase:"UNKNOWN",requiresUser:false});
  const w=missionWorkState({...base,waitStateJson:{questionId:"q",resolved:false},events:[{id:"q",type:"QUESTION",payloadJson:{question:"补目标设备日志"}}]},now);
  expect(w).toMatchObject({phase:"WAITING_USER",requiresUser:true,exactQuestionRef:"q",reasonText:"补目标设备日志"});
});
it("无新事件跨许可边界仍失效，不能继续承诺观察",()=>{
  const m={...base,waitStateJson:{waitingFor:"OBSERVATION"},continuationPolicyJson:policy};
  expect(missionWorkState(m,now).phase).toBe("WAITING_OBSERVATION");
  expect(missionWorkState(m,new Date(policy.expiresAt))).toMatchObject({phase:"PAUSED",nextActor:"USER",reasonCode:"DELEGATION_EXPIRED"});
  expect(missionWorkState({...m,delegationEnabled:false},now)).toMatchObject({phase:"UNAVAILABLE",reasonCode:"DELEGATION_DISABLED",requiresUser:false});
});
it("后台无变化事件不能掩盖尚未回答的真实用户问题",()=>{
  const state=missionWorkState({...base,waitStateJson:{questionId:"private-question",question:"补目标设备结果",waitingFor:"USER",missing:"PRIVATE"},continuationPolicyJson:policy,events:[{id:"poll",type:"INVESTIGATION_NO_NEW_INFORMATION",payloadJson:{}}]},now);
  expect(state).toMatchObject({phase:"WAITING_USER",requiresUser:true,exactQuestionRef:"private-question"});
});
it("READY与有效租约、过期租约分开；失败不显示Agent正在接续",()=>{
  expect(missionWorkState({...base,status:"READY"},now).phase).toBe("QUEUED");
  expect(missionWorkState({...base,status:"RUNNING",leaseUntil:new Date(+now+1)},now).phase).toBe("RUNNING");
  expect(missionWorkState({...base,status:"RUNNING",leaseUntil:now},now).phase).toBe("UNAVAILABLE");
  expect(missionWorkState({...base,status:"FAILED"},now).nextActor).toBe("SYSTEM");
});
it("UNKNOWN查询原请求；过期批准不能作为当前审批绑定",()=>{
  expect(missionWorkState({...base,status:"PAUSED",lastErrorJson:{code:"TOOL_UNKNOWN"}},now)).toMatchObject({phase:"UNKNOWN",actionLabel:"查询原请求",requiresUser:false});
  expect(missionWorkState({...base,status:"WAITING_APPROVAL",approvals:[{id:"old",expiresAt:now}]},now)).toMatchObject({exactApprovalRef:null,reasonCode:"APPROVAL_EXPIRED"});
});
it("Web与ArkTS选择同一原对象并携带同一workState，不受UI列表次序覆盖",()=>{
  const native={} as {focusPrimary:(v:GlobalFocus)=>FocusEntry};
  const code=ts.transpileModule(fs.readFileSync("harmonyos/entry/src/main/ets/common/GlobalFocusPresentation.ets","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext("(function(exports){"+code+"})",{})(native);
  const workState=missionWorkState({...base,waitStateJson:{waitingFor:"OBSERVATION"},continuationPolicyJson:policy},now);
  const primaryContext=selectProjectAgentContext({projectId:"p",projectTitle:"竞赛",projectGoal:"演示",projectUpdatedAt:now.toISOString(),candidates:[{kind:"MISSION",id:"original",status:"WAITING_INPUT",title:"当前委托",reason:workState.reasonText,updatedAt:now.toISOString(),workState}]});
  const view:GlobalFocus={primaryContext,schemaVersion:1,missionEnabled:true,archived:false,hasMore:false,counts:{waiting:0,running:0,reminders:0,actions:0},nextDeadline:null,waiting:[],running:[],reminders:[],actions:[],records:[]};
  expect(native.focusPrimary(view)).toMatchObject({id:focusPrimary(view)!.id,projectId:"p",workState,actionLabel:workState.actionLabel});
});
