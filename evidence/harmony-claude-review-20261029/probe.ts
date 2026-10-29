import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { continuityDatabase } from "../../tests/helpers/continuityDatabase";
const isolated=continuityDatabase("claude-ui-audit");
const {db}=await import("../../lib/db"),{actOnSignal}=await import("../../lib/sensing/repoSource");
try{
 const u=await db.user.create({data:{username:crypto.randomUUID(),displayName:"UI audit synthetic",passwordHash:"unused"}}),p=await db.project.create({data:{title:"撤销连接验收",description:"synthetic isolated",goal:"仅核对UI建议",scenario:"COMPETITION",memberships:{create:{userId:u.id}}}}),c=await db.sourceConnection.create({data:{projectId:p.id,ownerUserId:u.id,repo:"octokit/rest.js",ref:"main",status:"REVOKED",revokedAt:new Date()}}),s=await db.externalSignal.create({data:{projectId:p.id,ownerUserId:u.id,connectionId:c.id,sha:"a".repeat(40),title:"candidate from revoked connection",authorName:"fixture",url:"https://github.com/octokit/rest.js/commit/"+"a".repeat(40)}});
 const result=await actOnSignal(u.id,p.id,s.id,{action:"ADOPT",requestId:"audit"});
 console.log(JSON.stringify({finding:"REVOKED_CONNECTION_CANDIDATE_CAN_STILL_BE_ADOPTED",connectionStatus:c.status,resultStatus:result.signal.status,capturesCreated:await db.capture.count({where:{projectId:p.id}}),network:"NONE",data:"ISOLATED_SYNTHETIC"}));
}finally{await db.$disconnect();const target=path.resolve(isolated.dir),base=path.resolve(os.tmpdir());if(!target.startsWith(base+path.sep)||!path.basename(target).startsWith("pm-continuity-claude-ui-audit-"))throw new Error("INVALID_CLEANUP_TARGET");fs.rmSync(target,{recursive:true,force:true});}
