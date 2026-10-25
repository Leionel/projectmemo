import {AppError} from "@/lib/api";
import {textHash} from "@/lib/research/sourceRepository";
import type {Source} from "./contracts";
import {outputSchema} from "./tools";
import { blockSourceClasses } from "./sourceObservation";
export function validateResearchOutput(input:unknown,sources:Source[]){
 const body=outputSchema.parse(input);

 for(const b of body.blocks){
  if(b.kind==="PROJECT_OBSERVATION"&&b.sourceIds.some(id=>sources.some(s=>s.id===id&&blockSourceClasses(s,b.citations).some(c=>c!=="PROJECT_OBSERVATION"))))throw new AppError("EXTERNAL_NOT_PROJECT_FACT","外部参考或未决观察不能变成项目实测",422);
  if(b.kind==="EXTERNAL_REFERENCE"&&b.sourceIds.some(id=>!sources.some(s=>s.id===id&&blockSourceClasses(s,b.citations).every(c=>["EXTERNAL_REFERENCE","MIXED"].includes(c)))))throw new AppError("EXTERNAL_SOURCE_REQUIRED","外部参考必须引用已读取的原文；用户提供的摘录保留其身份",422);
  if(b.sourceIds.some(id=>sources.some(s=>s.id===id&&(s.kind==="EXTERNAL"||s.entityType==="ARTIFACT"&&s.knowledgeClass!=="PROJECT_OBSERVATION")))&&/(?:本项目|本实验|我们)(?:.{0,12})(?:达到|实测|验证通过|取得)/.test(b.text)&&!/(?:本项目|本实验|我们).{0,8}(?:未|没有|尚无|待验证)/.test(b.text))throw new AppError("EXTERNAL_NOT_PROJECT_FACT","公开指标不能表述为本项目实测",422);
  if((body.kind==="RESEARCH"&&b.kind!=="INFERENCE"||b.kind==="EXTERNAL_REFERENCE")&&!b.citations.length)throw new AppError("EXACT_CITATION_REQUIRED","研究稿的观察与参考需保留精确摘录",422);
  for(const c of b.citations){const source=sources.find(s=>s.id===c.sourceId);if(!source||!b.sourceIds.includes(c.sourceId)||c.end>source.text.length||c.start>=c.end||textHash(source.text.slice(c.start,c.end))!==c.excerptHash)throw new AppError("CITATION_CHANGED","引用摘录与来源不一致",409);}
 }
 return body;
}
