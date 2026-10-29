import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
export function isolatedContinuityEvaluation(label:string){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"pm-"+label+"-")),file=path.join(directory,"evaluation.db");
  Object.assign(process.env,{DATABASE_URL:"file:"+file.replaceAll("\\","/"),MISSION_ENABLED:"true",MISSION_WRITES_ENABLED:"true",MISSION_INVESTIGATION_DELEGATION_ENABLED:"true",REPO_CI_OBSERVER_ENABLED:"true",MISSION_WEB_ENABLED:"false",MISSION_CLAIM_JUDGE_ENABLED:"false",FOCUS_AGENT_ENABLED:"true",FOCUS_CONTINUITY_ENABLED:"true",SEMANTIC_MEMORY_ENABLED:"false",LLM_MODE:"mock"});
  const sql=new Database(file);sql.pragma("journal_mode=WAL");
  for(const name of fs.readdirSync("prisma/migrations").sort()){const p=path.join("prisma/migrations",name,"migration.sql");if(fs.existsSync(p))sql.exec(fs.readFileSync(p,"utf8"));}sql.close();return {directory,file};
}
export function continuityRuntimeHashes(){return Object.fromEntries(["lib/mission/runner.ts","lib/mission/repositoryTools.ts","lib/mission/delegationObservation.ts","lib/mission/investigationDelegation.ts","lib/mission/contextBuilder.ts","lib/mission/modelAdapter.ts","lib/mission/tools.ts","lib/agent/specialistPrompts.ts","lib/sensing/repoCi.ts","lib/continuity/sourcePolicy.ts"].map(p=>[p,createHash("sha256").update(fs.readFileSync(p)).digest("hex")]));}
