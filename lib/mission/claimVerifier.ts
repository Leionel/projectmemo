import {z} from "zod";
import {jsonHash,type Source} from "./contracts";
import {outputSchema} from "./tools";
import {textHash} from "@/lib/research/sourceRepository";
export const verdictSchema=z.enum(["ENTAILS","CONTRADICTS","NOT_ENOUGH_INFORMATION"]);
export type ClaimVerdict=z.infer<typeof verdictSchema>|"NOT_CHECKED";
export type JudgeRequest={claimId:string;text:string;kind:string;evidence:Array<{sourceId:string;kind:string;knowledgeClass?:string;text:string;context:string;hash:string;fullSource:boolean}>};
export type JudgeResult={verdict:z.infer<typeof verdictSchema>;provider:string;model:string;usage:{inputTokens:number|null;outputTokens:number|null}};
export type ClaimJudge=(request:JudgeRequest)=>Promise<JudgeResult>;
export type ClaimCheck={schemaVersion:1;verifierVersion:"r33-v1";claimId:string;blockId:string;text:string;claimStart:number;claimEnd:number;claimHash:string;status:ClaimVerdict;mode:"OFF"|"RULE"|"JUDGE";structuralCheck:"VALID"|"MISSING_EVIDENCE";reasonCode:string;sourceRefs:Array<{id:string;hash:string;start:number;end:number;excerptHash:string}>;provider?:string;model?:string;checkedAt:string};
const normalize=(s:string)=>s.normalize("NFKC").trim().replace(/\s+/g," ");
const numberPattern=/[-+]?\d+(?:\.\d+)?/g;
const numbers=(s:string)=>s.match(numberPattern)??[];
function ruleVerdict(claim:string,evidence:string):{status:ClaimVerdict;reasonCode:string}|null{
 const c=normalize(claim),e=normalize(evidence);
 if(c===e)return{status:"ENTAILS",reasonCode:"EXACT_QUOTATION"};
 const cn=numbers(c),en=numbers(e);
 if(cn.length&&cn.length===en.length&&c.replace(numberPattern,"#")===e.replace(numberPattern,"#")&&cn.some((v,i)=>Number(v)!==Number(en[i])))return{status:"CONTRADICTS",reasonCode:"NUMERIC_MISMATCH"};
 const polarity=/(?:没有|未)(?=(?:显著)?(?:改善|提升|通过|完成))|不(?=(?:支持|通过))/g;
 if(c.replace(polarity,"")===e.replace(polarity,"")&&(c.match(polarity)?.length??0)!==(e.match(polarity)?.length??0))return{status:"CONTRADICTS",reasonCode:"NEGATION_MISMATCH"};
 return null;
}
/** Structural validity and textual entailment are separate; inferred claims never inherit an exact-quote pass. */
export async function verifyResearchClaims(input:unknown,sources:Source[],options:{enabled:boolean;judge?:ClaimJudge;maxJudgeCalls?:number}):Promise<ClaimCheck[]>{
 const body=outputSchema.parse(input),checks:ClaimCheck[]=[];let calls=0;
 const segmenter=new Intl.Segmenter("zh",{granularity:"sentence"});
 const claims=body.blocks.flatMap(block=>{
  const segments=[...segmenter.segment(block.text)];
  return segments.slice(0,9).map((segment,index)=>{const start=segment.index,end=index===8?block.text.length:segment.index+segment.segment.length;return{...block,text:block.text.slice(start,end),claimId:`${block.blockId}:${start}`,claimStart:start,claimEnd:end,merged:index===8};});
 });
 for(const block of claims){
  const refs=block.citations.map(c=>({id:c.sourceId,hash:sources.find(s=>s.id===c.sourceId)?.hash??"",start:c.start,end:c.end,excerptHash:c.excerptHash}));
  const evidence=block.citations.flatMap(c=>{const s=sources.find(s=>s.id===c.sourceId);if(!s||!block.sourceIds.includes(s.id)||c.start<0||c.end>s.text.length||c.start>=c.end||textHash(s.text.slice(c.start,c.end))!==c.excerptHash)return[];return[{sourceId:s.id,kind:s.kind,knowledgeClass:s.knowledgeClass,text:s.text.slice(c.start,c.end),context:s.text.slice(Math.max(0,c.start-200),Math.min(s.text.length,c.end+200)),hash:s.hash,fullSource:c.start===0&&c.end===s.text.length}];});
  const check:ClaimCheck={schemaVersion:1,verifierVersion:"r33-v1",claimId:block.claimId,blockId:block.blockId,text:block.text,claimStart:block.claimStart,claimEnd:block.claimEnd,claimHash:jsonHash(block.text),status:"NOT_CHECKED",mode:options.enabled?"RULE":"OFF",structuralCheck:evidence.length&&evidence.length===block.citations.length?"VALID":"MISSING_EVIDENCE",reasonCode:options.enabled?"NO_SEMANTIC_CHECK":"FEATURE_DISABLED",sourceRefs:refs,checkedAt:new Date().toISOString()};
  if(!options.enabled){checks.push(check);continue;}
  if(block.merged){checks.push({...check,reasonCode:"CLAIM_LIMIT"});continue;}
  if(block.kind==="PROJECT_OBSERVATION"&&evidence.some(e=>e.kind==="EXTERNAL"||e.knowledgeClass&&e.knowledgeClass!=="PROJECT_OBSERVATION")){checks.push({...check,status:"CONTRADICTS",reasonCode:"ORIGIN_MISMATCH"});continue;}
  if(!evidence.length||evidence.length!==block.citations.length){checks.push({...check,status:"NOT_ENOUGH_INFORMATION",reasonCode:"MISSING_EVIDENCE"});continue;}
  const rules=evidence.map(e=>e.fullSource?ruleVerdict(block.text,e.text):null);
  // One contrary citation defeats an exact quote from another source. An exact quotation only supports its own scope.
  if(rules.some(r=>r?.status==="CONTRADICTS")){checks.push({...check,...rules.find(r=>r?.status==="CONTRADICTS")!});continue;}
  // Verbatim matching remains structural evidence. It does not bypass semantic review.
  const unitValue=/([-+]?\d+(?:\.\d+)?)\s*(%|ms|mm|cm|秒|毫秒|分钟|小时|MB|GB)(?=$|[\s。，,.;；])/gi;
  const units=(text:string)=>[...normalize(text).matchAll(unitValue)].map(m=>({value:Number(m[1]),unit:m[2].toLowerCase()}));
  const claimUnits=units(block.text),sourceUnits=evidence.flatMap(e=>units(e.context));
  if(claimUnits.some(c=>sourceUnits.some(s=>s.value===c.value&&s.unit!==c.unit)&&!sourceUnits.some(s=>s.value===c.value&&s.unit===c.unit))){checks.push({...check,status:"NOT_ENOUGH_INFORMATION",reasonCode:"UNIT_MISMATCH"});continue;}
  const claimNumbers=numbers(normalize(block.text));
  if(claimNumbers.some(n=>!evidence.some(e=>numbers(normalize(e.context)).some(v=>Number(v)===Number(n))))){checks.push({...check,status:"NOT_ENOUGH_INFORMATION",reasonCode:"UNSUPPORTED_NUMBER"});continue;}
  if(!options.judge||calls>=(options.maxJudgeCalls??3)){checks.push({...check,reasonCode:options.judge?"JUDGE_CALL_LIMIT":"JUDGE_NOT_CONFIGURED"});continue;}
  if(JSON.stringify(evidence).length>8000){checks.push({...check,reasonCode:"EVIDENCE_LIMIT"});continue;}
  calls++;
  try{const result=await options.judge({claimId:block.claimId,text:block.text,kind:block.kind,evidence});checks.push({...check,status:verdictSchema.parse(result.verdict),mode:"JUDGE",reasonCode:"MODEL_JUDGMENT",provider:result.provider,model:result.model});}
  catch(error){const code=(error as {code?:string})?.code;checks.push({...check,mode:"JUDGE",reasonCode:code==="BUDGET_EXHAUSTED"?"JUDGE_BUDGET_EXHAUSTED":code==="JUDGE_DISABLED"?"FEATURE_DISABLED":"JUDGE_UNAVAILABLE"});}
 }
 return checks;
}
