import { AppError } from "@/lib/api";
import { constraintsSchema } from "./contracts";
export function assertToolConstraints(raw:unknown,tool:string,args:unknown){
 const value=raw as Record<string,unknown>;const c=constraintsSchema.parse(Object.fromEntries(Object.entries(value).filter(([k])=>k!=="llmContextApproved")));
 if(tool==="propose_action"&&c.executionBoundary!=="PROPOSE_ACTION")throw new AppError("CONSTRAINT_BLOCKED","当前委托只允许读取和分析",409);
 const text=JSON.stringify(args).toLocaleLowerCase();
 for(const term of [...c.forbiddenApproaches,...c.rejectedActions])if(text.includes(term.toLocaleLowerCase()))throw new AppError("CONSTRAINT_BLOCKED","该方案被用户禁止或否决，请调整方案",409);
 if(tool==="propose_action"&&c.deadline){const due=(args as {dueAt?:string}).dueAt;if(due&&+new Date(due)>+new Date(c.deadline))throw new AppError("CONSTRAINT_BLOCKED","行动期限超过委托截止时间",409);}
}
