import "dotenv/config";
import fs from "node:fs";
import {z} from "zod";
import {verifyResearchClaims,verdictSchema,type ClaimJudge} from "../lib/mission/claimVerifier";
import {configuredClaimJudge} from "../lib/mission/claimJudgeAdapter";
import {textHash} from "../lib/research/sourceRepository";
const args=process.argv.slice(2),live=args.includes("--live"),capArg=args.find(a=>a.startsWith("--max-calls=")),cap=capArg?Number(capArg.split("=")[1]):0;
if(live&&(!Number.isInteger(cap)||cap<1||cap>50))throw new Error("真实Judge评测必须明确 --max-calls=1..50；离线模式不调用模型");
const nullableLabel=verdictSchema.nullable();
const schema=z.object({schemaVersion:z.literal(1),source:z.string(),items:z.array(z.object({id:z.string(),split:z.enum(["development","holdout"]),claim:z.string(),evidence:z.string(),kind:z.enum(["PROJECT_OBSERVATION","EXTERNAL_REFERENCE","INFERENCE"]),expectedByFixtureAuthor:verdictSchema,labelA:nullableLabel,labelB:nullableLabel,reviewerA:z.string().nullable(),reviewerB:z.string().nullable()}))});
const fixture=schema.parse(JSON.parse(fs.readFileSync("tests/fixtures/claims/r33-synthetic.json","utf8")));
let calls=0,knownInputTokens=0,knownOutputTokens=0,unknownCalls=0;
const judge:ClaimJudge|undefined=live?async request=>{if(calls>=cap)throw new Error("评测调用预算已耗尽");calls++;unknownCalls++;const result=await configuredClaimJudge(request);if(result.usage.inputTokens!==null&&result.usage.outputTokens!==null){unknownCalls--;knownInputTokens+=result.usage.inputTokens;knownOutputTokens+=result.usage.outputTokens;}return result;}:undefined;
const results=[];
for(const item of fixture.items){const hash=textHash(item.evidence),source={id:`fixture:${item.id}`,kind:"EXTERNAL" as const,entityType:"EXTERNAL_SOURCE" as const,hash,revision:hash,text:item.evidence,observedAt:new Date().toISOString()};const [result]=await verifyResearchClaims({blocks:[{blockId:item.id,kind:item.kind,text:item.claim,sourceIds:[source.id],citations:[{sourceId:source.id,start:0,end:item.evidence.length,excerptHash:hash}]}]},[source],{enabled:true,judge});const independentlyLabeled=!!item.reviewerA&&!!item.reviewerB&&item.reviewerA!==item.reviewerB&&!!item.labelA&&!!item.labelB;results.push({id:item.id,split:item.split,status:result.status,mode:result.mode,fixtureExpectation:item.expectedByFixtureAuthor,independentlyLabeled,agreement:independentlyLabeled?item.labelA===item.labelB:null,consensus:independentlyLabeled&&item.labelA===item.labelB?item.labelA:null});}
const consensus=results.filter(r=>r.consensus),supported=consensus.filter(r=>r.status==="ENTAILS"),falseSupport=supported.filter(r=>r.consensus!=="ENTAILS").length;
process.stdout.write(JSON.stringify({schemaVersion:1,mode:live?"LIVE_JUDGE":"OFFLINE_RULES",fixtureSource:fixture.source,calls,cap,knownInputTokens,knownOutputTokens,unknownCalls,independentLabels:results.filter(r=>r.independentlyLabeled).length,disagreements:results.filter(r=>r.agreement===false).length,metrics:{supportPrecision:supported.length?(supported.length-falseSupport)/supported.length:null,falseSupport:supported.length?falseSupport:null,overRefusal:consensus.length?consensus.filter(r=>r.consensus==="ENTAILS"&&r.status!=="ENTAILS").length:null},acceptance:"双人标注与真实Judge质量需另行验收；合成规则回归不等于语义支持率",results},null,2)+"\n");
