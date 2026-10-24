import {expect,it} from "vitest";
import fs from "node:fs";
import {createHash} from "node:crypto";
it("frozen manifest preserves ten categories, original failures and a single cumulative ledger",()=>{
  const root="evidence/p0-c/20261023-live-recovery/";
  const manifest=JSON.parse(fs.readFileSync("evidence/p0-c/task-manifest-v1.json","utf8"));
  expect(new Set(manifest.cases.map((c:{id:string})=>c.id)).size).toBe(10);
  for(const c of manifest.cases){expect(fs.existsSync(c.deterministicEntry)).toBe(true);expect(c.humanLabel).toBeNull();}
  const result=JSON.parse(fs.readFileSync(root+"results.json","utf8")),ledger=JSON.parse(fs.readFileSync(root+"budget.json","utf8")),assessment=JSON.parse(fs.readFileSync(root+"assessment.json","utf8"));
  expect(result.runId).toBe(ledger.runId);expect(ledger.entries.length).toBe(23);expect(result.attempts.filter((a:{status:string})=>a.status==="FAILED")).toHaveLength(2);
  expect(assessment.latestTrials.map((t:{historical:boolean})=>t.historical)).toEqual([true,false,false]);
  for(const [name,hash] of Object.entries(assessment.files))expect(createHash("sha256").update(fs.readFileSync(root+name)).digest("hex")).toBe(hash);
});
