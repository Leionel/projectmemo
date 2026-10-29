import { afterAll,expect,test,vi } from "vitest";
const isolated=await vi.hoisted(async()=>(await import("./helpers/continuityDatabase")).continuityDatabase("academic-integration"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitConversationTurn } from "@/lib/conversation/turnService";
import { registerUserUrls,readConversationResearchTool } from "@/lib/conversation/researchTools";
import { updateResearchScope,validateWebSource } from "@/lib/conversation/researchScope";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { submitDirective } from "@/lib/continuity/directiveService";
import { createMission,missionDetail,editMission } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { observation,persistObservations,listSources } from "@/lib/research/sourceRepository";
afterAll(async()=>{await db.$disconnect();fs.rmSync(isolated.dir,{recursive:true,force:true});});
const url="https://doi.org/10.1234/example",scope={enabled:true,academicMetadata:true,topic:"公开分割方法",publicTerms:["segmentation"],allowedCategories:["PUBLIC_TOPIC","PUBLIC_SOURCE"]};
async function fixture(){
 Object.assign(process.env,{ACADEMIC_RESEARCH_ENABLED:"true",FOCUS_WEB_ENABLED:"true",MISSION_WEB_ENABLED:"true",FOCUS_CONTINUITY_ENABLED:"false"});
 const u=await db.user.create({data:{username:crypto.randomUUID(),displayName:"合成论文用户",passwordHash:"unused"}}),p=await db.project.create({data:{title:"论文对照",goal:"比较公开论文与本地结果",description:"SYNTHETIC",scenario:"RESEARCH",memberships:{create:{userId:u.id}}}}),actor={userId:u.id,sessionId:(await createSession(u.id)).session.id};
 const c=await createConversation(actor,{requestId:"c",scope:"PROJECT",projectId:p.id});await updateResearchScope(actor,c.id,{expectedRevision:1,projectId:p.id,scope});
 const turn=await submitConversationTurn(actor,c.id,{requestId:"read",expectedVersion:1,projectId:p.id,message:"读取公开论文 "+url},undefined,{defer:true});const [parent]=await registerUserUrls(actor,c.id,turn.turnId,p.id,"读取公开论文 "+url);
 return {u,p,actor,c,turn,parent,call:{tool:"read_paper_metadata" as const,projectId:p.id,sourceId:parent.sourceId,revision:parent.revision,scopeRevision:2}};
}
const response=()=>new Response(JSON.stringify({message:{DOI:"10.1234/example",title:["Synthetic paper"],abstract:"<p>Reported on public data only.</p>",published:{"date-parts":[[2025]]},relation:{"is-preprint-of":[{id:"10.1234/v2","id-type":"doi"}]}}}));
test("original Turn persists metadata, reuses same HTTP reply, and parent suppression taints metadata and Artifact",async()=>{
 const f=await fixture(),fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>response());
 try{
  const a=await readConversationResearchTool(f.actor,f.c.id,f.turn.turnId,"metadata",f.call),b=await readConversationResearchTool(f.actor,f.c.id,f.turn.turnId,"metadata",f.call);
  expect(fetcher).toHaveBeenCalledTimes(1);expect(a.sources).toEqual(b.sources);expect(a.sources[0].external).toMatchObject({provider:"Crossref",readLevel:"ACADEMIC_METADATA",provenanceSourceIds:[f.parent.sourceId]});expect(a.sources[0].excerpt).toContain("未读取全文");
  const artifact=await db.generatedArtifact.create({data:{projectId:f.p.id,artifactType:"weekly_report",content:"合成论文参考",sourceRefs:{sources:[{sourceId:a.sources[0].sourceId,projectId:f.p.id}]}}});
  await submitDirective(f.actor,f.c.id,{commandId:"suppress",expectedSeq:0,scope:{projectId:f.p.id},operation:"SUPPRESS_USE",sourceIds:[f.parent.sourceId]});
  expect((await sourceUse(f.u.id,f.p.id,"artifact:"+artifact.id)).state).toBe("SUPPRESSED");await expect(validateWebSource(f.actor,a.sources[0])).rejects.toThrow();
 }finally{fetcher.mockRestore();}
});
test("scope revocation before metadata reply prevents usable source; unknown transport is never retried under a new operation",async()=>{
 const f=await fixture(),fetcher=vi.spyOn(globalThis,"fetch").mockImplementation(async()=>{await updateResearchScope(f.actor,f.c.id,{expectedRevision:2,projectId:f.p.id,scope:{...scope,academicMetadata:false}});return response();});
 try{await expect(readConversationResearchTool(f.actor,f.c.id,f.turn.turnId,"late",f.call)).rejects.toMatchObject({code:"SCOPE_CHANGED"});}finally{fetcher.mockRestore();}
 const g=await fixture(),unknown=vi.spyOn(globalThis,"fetch").mockRejectedValue(new Error("LOST_RESPONSE"));
 try{
  await expect(readConversationResearchTool(g.actor,g.c.id,g.turn.turnId,"first",g.call)).rejects.toMatchObject({code:"EXTERNAL_RESULT_UNKNOWN"});
  await expect(readConversationResearchTool(g.actor,g.c.id,g.turn.turnId,"different-name",g.call)).rejects.toMatchObject({code:"EXTERNAL_RESULT_UNKNOWN"});expect(unknown).toHaveBeenCalledTimes(1);
 }finally{unknown.mockRestore();}
});
test("original Mission metadata ledger shares bounded HTTP accounting; missing separate consent makes zero outbound calls",async()=>{
 const f=await fixture(),m=await createMission(f.u.id,{projectId:f.p.id,requestId:"m",goal:f.p.goal,llmContextApproved:true,researchScope:scope});
 const parent=observation(m.id,url,"SEARCH_SNIPPET","公开DOI","Observed public DOI only");await db.$transaction(tx=>persistObservations(tx,m.id,{observations:[parent]}));const transport=vi.fn(async()=>response());
 const run=()=>runMissionSlice({id:m.id,academic:transport,provider:async()=>({choice:{kind:"tool",tool:"read_paper_metadata",args:{sourceId:parent.id,revision:parent.normalizedContentHash,scopeRevision:1},summary:"核对DOI元数据"},provider:"SCRIPTED_LOCAL",model:"fixture",protocol:"JSON_CHOICE",usage:{inputTokens:1,outputTokens:1}})});
 await run();let view=await missionDetail(f.u.id,m.id);expect(view.steps[0].status).toBe("SUCCEEDED");expect(view.used).toMatchObject({metadataRequests:1});expect(await db.externalSource.count({where:{missionId:m.id,retrievalMode:"ACADEMIC_METADATA"}})).toBe(1);
 await editMission(f.u.id,m.id,"research-scope",{requestId:"revoke",expectedVersion:view.version,expectedScopeVersion:view.researchScopeVersion,scope:{...scope,academicMetadata:false}});
 const history=await listSources(f.u.id,m.id);expect(history.find(s=>s.retrievalMode==="ACADEMIC_METADATA")?.availability).toBe("SCOPE_CHANGED");
 await run();view=await missionDetail(f.u.id,m.id);expect(transport).toHaveBeenCalledTimes(1);expect(view.status).toBe("PAUSED");
});
