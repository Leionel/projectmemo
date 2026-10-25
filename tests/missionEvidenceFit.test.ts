import { describe,it,expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { makeFitPremise,evaluateEvidenceFit } from "@/lib/mission/evidenceFit";
import type { EvidenceFitRequirement,FitMaterial } from "@/lib/types/missionEvidenceFit";
const question="本项目模型A（权重a1）在目标设备D（8GB GPU）、推理batch=1、FP16条件下，2026-10，约定GPU内存预算6GB：本次峰值是否不超过6GB？";
export const requirement:EvidenceFitRequirement={schemaVersion:1,domain:"TECH_RESOURCE_MEASUREMENT",measurement:{name:"GPU_MEMORY",unit:"GB",upperLimit:6},checks:[
 {id:"SUBJECT",expected:"本项目模型A权重a1",basis:{kind:"QUESTION",quote:"本项目模型A（权重a1）"}},
 {id:"STAGE",expected:"推理",basis:{kind:"QUESTION",quote:"推理batch=1"}},
 {id:"CONDITION_1",expected:"目标设备D",basis:{kind:"QUESTION",quote:"目标设备D（8GB GPU）"}},
 {id:"CONDITION_2",expected:"batch=1、FP16",basis:{kind:"QUESTION",quote:"推理batch=1、FP16条件下"}},
]};
const premise=makeFitPremise(requirement,{questionId:"q",question,goal:"在目标设备D演示",constraints:{},constraintsVersion:1,scopeVersion:1});
const good="2026-10，本项目模型A权重a1，目标设备D（8GB GPU），推理batch=1、FP16，运行r1，显存峰值5.2GB。";
function material(text=good,id="capture:a",state:FitMaterial["sourceState"]="CURRENT"):FitMaterial{return{id,hash:createHash("sha256").update(text).digest("hex"),revision:"v1",text,sourceState:state,coverage:{loadedCharacters:text.length,totalCharacters:text.length,truncated:false}};}
describe("E0逐观察适用性（SYNTHETIC，参考标准未替代人工金标）",()=>{
 const frozen=JSON.parse(fs.readFileSync("tests/fixtures/missionEvidenceFit-v2.json","utf8")) as {tasks:Array<{id:string;sources:Array<{id:string;text:string;sourceState:FitMaterial["sourceState"]}>}>};
 const expected:Record<string,string>={T01:"FIT",T02:"NOT_FIT",T03:"NOT_FIT",T04:"NOT_FIT",T05:"FIT",T06:"UNKNOWN",T07:"NOT_FIT",T08:"FIT",T09:"UNKNOWN",T10:"UNKNOWN",T15:"FIT"};
 it.each(frozen.tasks.filter(t=>t.id in expected))("冻结开发夹具 $id（非人工金标成绩）",task=>{
  const fit=evaluateEvidenceFit(premise,task.sources.map(s=>material(s.text,`capture:${s.id}`,s.sourceState)));
  expect(fit.fitStatus).toBe(expected[task.id]);
 });
 it("明确同条件测量可用，负结果不会被过滤",()=>{
  expect(premise.basisStatus).toBe("GROUNDED");
  expect(evaluateEvidenceFit(premise,[material()])).toMatchObject({fitStatus:"FIT",groups:[{measurementResult:"WITHIN_LIMIT",measurementValue:5.2}],semanticVerification:"NOT_CHECKED"});
  expect(evaluateEvidenceFit(premise,[material(good.replace("5.2","6.8"))])).toMatchObject({fitStatus:"FIT",groups:[{measurementResult:"EXCEEDS_LIMIT"}]});
 });
 it("训练和外部论文不能变为本项目推理观察",()=>{
  expect(evaluateEvidenceFit(premise,[material(good.replace("推理","训练"))]).fitStatus).toBe("NOT_FIT");
  const fit=evaluateEvidenceFit(premise,[material("论文P报告：服务器S运行模型A，推理显存5.2GB，batch=1、FP16。本项目设备D尚未测试。")]);
  expect(fit.fitStatus).not.toBe("FIT");expect(fit.groups[0].origin).toBe("USER_PROVIDED_REFERENCE");
 });
 it("不跨文件、不跨同文件的独立观察补条件",()=>{
  const a=material("2026-10，本项目模型A权重a1，目标设备D，训练运行t1，显存峰值5.2GB。"),b=material("目标设备D的推理要求：batch=1、FP16。","capture:b");
  expect(evaluateEvidenceFit(premise,[a,b]).fitStatus).not.toBe("FIT");
  expect(evaluateEvidenceFit(premise,[material(a.text+"\n"+b.text)]).fitStatus).not.toBe("FIT");
 });
 it("受控同义、无关背景不阻塞有效组",()=>{
  expect(evaluateEvidenceFit(premise,[material(good.replace("显存","GPU内存")),material("明天会议在教学楼。","capture:b")]).fitStatus).toBe("FIT");
 });
 it("缺条件、计划、否定、只有预算、未覆盖和旧源均不假报FIT",()=>{
  const examples=["显存峰值5.2GB。",`计划${good}`,good.replace("显存峰值5.2GB","未测显存"),good.replace("显存峰值5.2GB","要求显存不超过6GB")];
  for(const text of examples)expect(evaluateEvidenceFit(premise,[material(text)]).fitStatus).not.toBe("FIT");
  for(const state of ["SUPERSEDED","CONTESTED","UNKNOWN","UNREADABLE"] as const)expect(evaluateEvidenceFit(premise,[material(good,"capture:a",state)]).fitStatus).not.toBe("FIT");
  const source=material();source.coverage.truncated=true;source.coverage.totalCharacters=15000;
  expect(evaluateEvidenceFit(premise,[source])).toMatchObject({fitStatus:"UNKNOWN",coverage:{truncatedSourceIds:[source.id]}});
 });
 it("相反同run原文保持冲突，排序稳定且拒绝重复",()=>{
  const a=material(),b=material(good.replace("5.2","6.8"),"capture:b");
  expect(evaluateEvidenceFit(premise,[a,b])).toMatchObject({fitStatus:"UNKNOWN",conflicts:["RUN_CONFLICT:r1"]});
  expect(evaluateEvidenceFit(premise,[a,b])).toEqual(evaluateEvidenceFit(premise,[b,a]));
  expect(()=>evaluateEvidenceFit(premise,[a,a])).toThrow("FIT_SOURCE_LIMIT_OR_DUPLICATE");
 });
 it("UTF16范围回指原文，前提hash绑定原问题和约束版本",()=>{
  const source=material("🧪"+good),fit=evaluateEvidenceFit(premise,[source]);
  const span=fit.groups[0].spans[0];expect(createHash("sha256").update(source.text.slice(span.start,span.end)).digest("hex")).toBe(span.excerptHash);
  expect(makeFitPremise(requirement,{questionId:"q",question,goal:"在目标设备D演示",constraints:{},constraintsVersion:2,scopeVersion:1}).premiseHash).not.toBe(premise.premiseHash);
  expect(makeFitPremise(requirement,{questionId:"q",question:"另一个无测量条件的问题",goal:"项目",constraints:{},constraintsVersion:1,scopeVersion:1}).basisStatus).toBe("UNRESOLVED");
 });
});
