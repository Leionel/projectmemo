import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const folder = path.resolve('evidence/review-20260913');
const databasePath = path.join(folder, `probe-${Date.now()}.db`);
const sqlite = new Database(databasePath);
for (const name of fs.readdirSync('prisma/migrations').sort()) {
  const file = path.join('prisma/migrations', name, 'migration.sql');
  if (fs.existsSync(file)) sqlite.exec(fs.readFileSync(file, 'utf8'));
}
sqlite.close();
process.env.DATABASE_URL = `file:${databasePath.replaceAll('\\', '/')}`;
process.env.PROJECT_STATE_ENABLED = '1';
const { db } = await import('../../lib/db');
const { refreshProjectState, getLatestProjectState } = await import('../../lib/services/projectStateService');
const { updateActionFeasibilityInput } = await import('../../lib/services/actionFeasibilityService');
const { buildProjectState } = await import('../../lib/projectState/buildSnapshot');
try {
 const p = await db.project.create({data:{title:'isolated acceptance',description:'',goal:'A',scenario:'COMPETITION'}});
 const a = await refreshProjectState(p.id);
 await db.project.update({where:{id:p.id},data:{goal:'B'}});
 const b = await refreshProjectState(p.id);
 await db.project.update({where:{id:p.id},data:{goal:'A'}});
 const a2 = await refreshProjectState(p.id);
 const latest = await getLatestProjectState(p.id);
 const cap = await db.capture.create({data:{projectId:p.id,rawText:'unconfirmed'}});
 const card = await db.knowledgeCard.create({data:{projectId:p.id,captureId:cap.id,type:'idea',title:'unconfirmed',summary:'unconfirmed',keywords:[],relatedTasks:[],nextActions:[],importance:3}});
 const action = await db.actionItem.create({data:{projectId:p.id,title:'dependent'}});
 const feasibility = await updateActionFeasibilityInput(p.id,{actionId:action.id,addRequirements:[{targetKind:'card',targetId:card.id}]});
 const input = {projectId:p.id,goal:'A',deadline:null,cards:['a','b'].map(id=>({id,title:id,summary:id,createdAt:'2026-09-01T00:00:00Z'})),relations:[{id:'r',relationType:'CONTRADICTS',reason:'conflict',confirmed:true,confirmedAt:'2026-09-01T00:00:00Z',revokedAt:null,currentCardId:'a',relatedCardId:'b',counterpartTitle:'a'}],actions:[],deliverables:[],now:'2026-09-12T00:00:00Z'};
 const built = buildProjectState(input);
 const later = buildProjectState({...input,now:'2026-09-12T00:00:01Z'});
 const result = {databasePath,recurrence:{a:a.snapshot.id,b:b.snapshot.id,a2:a2.snapshot.id,reused:a2.reused,latestGoal:latest?.payload.goal},conflictFacts:built.facts,stableContentHash:built.contentHash===later.contentHash,unconfirmedDependency:feasibility};
 const { correctAttachmentText } = await import('../../lib/services/attachmentService');
 const { getDecisionTimeline } = await import('../../lib/services/temporalLedgerService');
 process.env.LLM_MODE = 'mock';
 const att = await db.attachment.create({data:{projectId:p.id,type:'PDF',storageKey:'audit',fileName:'audit.pdf',mimeType:'application/pdf',size:1,sha256:'audit',extractedText:'原始',extractionStatus:'SUCCESS'}});
 const v1 = await correctAttachmentText(p.id,att.id,'人工校对温度为350度');
 await correctAttachmentText(p.id,att.id,'人工校对温度为355度');
 await correctAttachmentText(p.id,att.id,'人工校对温度为360度');
 const timeline = await getDecisionTimeline(p.id);
 const revisionStates = timeline.items.filter(i=>i.card.id===v1.card?.id).map(i=>({status:i.status,support:i.supportState}));
 await updateActionFeasibilityInput(p.id,{actionId:action.id,estimatedMinutes:90});
 const clearBody = JSON.parse(JSON.stringify({actionId:action.id,estimatedMinutes:undefined}));
 const afterClear = await updateActionFeasibilityInput(p.id,clearBody);
 const extra = {revisionStates,afterClearEstimate:afterClear.estimateMinutes,serializedClearBody:clearBody};
 fs.writeFileSync(path.join(folder,'extra-results.json'),JSON.stringify(extra,null,2));
 console.log(JSON.stringify(extra,null,2));
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));
} finally {await db.$disconnect();}

