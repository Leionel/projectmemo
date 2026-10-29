import { E2E_DATABASE_URL } from './e2e-env';
if (process.env.DATABASE_URL !== E2E_DATABASE_URL) throw new Error('PR6 fixture requires isolated E2E database');
const [operation, value] = process.argv.slice(2);
const { db } = await import('../lib/db');
try {
  if (operation === 'remove') {
    const project = await db.project.findFirstOrThrow({where:{id:value,description:'PR6_BROWSER_FIXTURE_ONLY'}});
    const conversations=await db.conversation.findMany({where:{homeProjectId:project.id}});
    for(const c of conversations) { await db.agentRun.deleteMany({where:{conversationId:c.id}}); await db.conversation.delete({where:{id:c.id}}); }
    await db.project.delete({where:{id:project.id}});
  } else if(operation === 'create') {
    Object.assign(process.env,{FOCUS_AGENT_ENABLED:'true',FOCUS_AGENT_R4_ENABLED:'true',FOCUS_CONTINUITY_ENABLED:'false',FOCUS_WEB_ENABLED:'true',LLM_MODE:'mock'});
    const { createSession }=await import('../lib/auth/session');
    const actor={userId:value,sessionId:(await createSession(value)).session.id};
    const project=await db.project.create({data:{title:'PR6 公开研究交互验收',description:'PR6_BROWSER_FIXTURE_ONLY',goal:'核对公开方法与项目实测的边界',scenario:'RESEARCH',memberships:{create:{userId:value}}}});
    const { createConversation,appendConversationMessage }=await import('../lib/conversation/service');
    const { submitConversationTurn }=await import('../lib/conversation/turnService');
    const { updateResearchScope }=await import('../lib/conversation/researchScope');
    const { registerUserUrls,readConversationResearchTool }=await import('../lib/conversation/researchTools');
    const { emptyBlocks }=await import('../lib/conversation/repository');
    const { json }=await import('../lib/mission/contracts');
    const c=await createConversation(actor,{requestId:'create',scope:'PROJECT',projectId:project.id});
    await updateResearchScope(actor,c.id,{expectedRevision:1,projectId:project.id,scope:{enabled:true,topic:'公开研究验证',publicTerms:['公开研究'],allowedHosts:['arxiv.org']}});
    const message='请核对公开来源 https://arxiv.org/abs/2601.00001';
    const turn=await submitConversationTurn(actor,c.id,{requestId:'fixture',expectedVersion:1,message,projectId:project.id},undefined,{defer:true});
    const {newTurnLease,withTurnLease,withTurnGeneration}=await import('../lib/conversation/turnRuntime');
    const lease=newTurnLease();
    await db.conversationTurn.update({where:{id:turn.turnId},data:{leaseToken:lease,leaseUntil:new Date(Date.now()+60000)}});
    await withTurnLease(turn.turnId,lease,()=>withTurnGeneration(0,async()=>{
    const [original]=await registerUserUrls(actor,c.id,turn.turnId,project.id,message);
    const read=await readConversationResearchTool(actor,c.id,turn.turnId,'fixture-fetch',{tool:'web_fetch',projectId:project.id,sourceId:original.sourceId,scopeRevision:2},{name:'SYNTHETIC_HTTP_STUB',search:async()=>[],fetchPage:async()=>({title:'合成公开研究资料',content:'这份合成资料仅用于界面验收。公开结果需要在本项目的同条件数据上验证。'})});
    const s=read.sources[0], coverage={schemaVersion:1 as const,questionHash:'fixture',scopeRevision:2,asOf:'2026-10-27',facets:[{id:'validation',question:'公开结果能否外推到本项目',kind:'PROJECT_FACT' as const,coverage:'UNKNOWN' as const,sourceIds:[s.id],missing:['本项目同条件实测'],conflicts:[]}],nextDecision:'ANSWER_CONDITIONALLY' as const,expectedDecisionChange:'取得实测后再决定',stopReason:'NEED_PROJECT_RESULT' as const};
    await db.$transaction(async tx=>{
      await appendConversationMessage(tx,c.id,value,'ASSISTANT','先补同条件验证，再决定是否采用。【1】',{...emptyBlocks(),sources:[s],citations:[{sourceId:s.id,quote:'公开结果需要在本项目的同条件数据上验证。'}],observedProjectIds:[project.id],provider:'SYNTHETIC_HTTP_STUB',researchCoverage:coverage},turn.turnId);
      await tx.conversationTurn.update({where:{id:turn.turnId},data:{status:'ANSWERED'}});
      await tx.conversation.update({where:{id:c.id},data:{activeTurnId:null,version:{increment:1},focusJson:json({projectId:project.id})}});
    });
    }));
    console.log(JSON.stringify({projectId:project.id,conversationId:c.id}));
  } else throw new Error('Expected create/remove');
} finally { await db.$disconnect(); }
