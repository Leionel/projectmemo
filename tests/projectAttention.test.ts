import {expect,it} from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {selectProjectFocus} from "@/lib/projectAttention";

const exports:{selectProjectFocus:typeof selectProjectFocus}={} as {selectProjectFocus:typeof selectProjectFocus};
const code=ts.transpileModule(fs.readFileSync("harmonyos/entry/src/main/ets/common/ProjectAttention.ets","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInNewContext("(function(exports){"+code+"})",{})(exports);
it.each([
 ["WAITING_INPUT",5,0,true,"reminder"],
 ["RUNNING",4,4,true,"reminder"],
 ["WAITING_INPUT",3,4,true,"mission"],
 ["WAITING_APPROVAL",0,0,true,"mission"],
 ["PAUSED",0,0,false,"mission"],
 ["FAILED",0,0,false,"mission"],
 ["RUNNING",0,3,true,"deadline"],
 ["READY",0,0,true,"mission"],
 ["",0,0,true,"action"],
 ["",2,0,false,"reminder"],
 ["",0,0,false,"capture"],
])("双端焦点：%s / severity %s / deadline %s",(status,severity,deadline,action,expected)=>{
 expect(selectProjectFocus(String(status),Number(severity),Number(deadline),Boolean(action))).toBe(expected);
 expect(exports.selectProjectFocus(String(status),Number(severity),Number(deadline),Boolean(action))).toBe(expected);
});
