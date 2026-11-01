import { z } from "zod";
import { publicUrl } from "@/lib/research/queryPolicy";
const id=z.string().min(1).max(160);
const path=z.string().max(200).regex(/^\/[A-Za-z0-9/_\-.]*$/).refine(v=>!v.includes("..")&&!v.includes("//")&&!/(?:^|\/)(?:logout|delete|remove|restart|reboot|deploy|trigger|execute|confirm|callback)(?:\/|$)/i.test(v),"只能指定无副作用的固定读取路径");
export const deploymentConfigSchema=z.object({
  schemaVersion:z.literal(1), environment:z.string().trim().min(1).max(80),
  origin:z.string().max(300).superRefine((v,ctx)=>{try{const u=new URL(publicUrl(v));if(u.pathname!=="/"||u.search)throw new Error();}catch{ctx.addIssue({code:"custom",message:"观察地址只能包含公开HTTPS origin"});}}).transform(v=>new URL(v).origin),
  expectedRelease:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{6,79}$/),
  healthPath:path.default("/health"), userPath:path.optional(), logPath:path.optional(),
  expiresAt:z.string().datetime(), freshnessSeconds:z.number().int().min(30).max(3600).default(600),
}).strict();
export type DeploymentConfig=z.infer<typeof deploymentConfigSchema>;
export const createDeploymentSchema=z.object({requestId:id,confirmedReadOnly:z.literal(true),config:deploymentConfigSchema}).strict();
export const deploymentControlSchema=z.discriminatedUnion("action",[
  z.object({requestId:id,expectedVersion:z.number().int().nonnegative(),action:z.literal("REVOKE")}).strict(),
  z.object({requestId:id,expectedVersion:z.number().int().nonnegative(),action:z.literal("REVISE"),confirmedReadOnly:z.literal(true),config:deploymentConfigSchema}).strict(),
]);
export const deploymentToolSchemas=[
  z.object({tool:z.literal("inspect_deployment"),projectId:id,connectionId:id,revision:id}).strict(),
  z.object({tool:z.literal("read_deployment_logs"),projectId:id,connectionId:id,revision:id}).strict(),
] as const;
export type DeploymentCall=z.infer<typeof deploymentToolSchemas[number]>;
export type DeploymentLayer={layer:"BUILD"|"DEPLOY"|"SERVICE"|"USER_PATH";state:"OBSERVED"|"FAILED"|"UNKNOWN"|"PARTIAL"|"STALE";description:string;path?:string;httpStatus?:number};
export type DeploymentSourceMeta={connectionId:string;connectionRevision:number;environment:string;origin:string;expectedRelease:string;
  reportedRelease:string|null;observedAt:string;validUntil:string;kind:"STATUS"|"LOG";conversationId?:string;turnId?:string;missionId?:string};
