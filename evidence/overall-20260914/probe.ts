import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const dir=path.resolve('evidence/overall-20260914');
const file=path.join(dir,`isolated-${Date.now()}.db`);
const sql=new Database(file);
for(const name of fs.readdirSync('prisma/migrations').sort()){
 const p=path.join('prisma/migrations',name,'migration.sql');
 if(fs.existsSync(p))sql.exec(fs.readFileSync(p,'utf8'));
}
sql.close();
process.env.DATABASE_URL=`file:${file.replaceAll('\\','/')}`;
process.env.LLM_MODE='mock';
process.env.PROJECT_STATE_ENABLED='true';
const {db}=await import('../../lib/db');
const {createMeetingImpactPreview:preview,confirmMeetingChanges:confirm}=await import('../../lib/services/meetingStateDiffService');
const {updateActionFeasibilityInput:update}=await import('../../lib/services/actionFeasibilityService');
const results:Record<string,unknown>={};
try{
 const p=await db.project.create({data:{title:'整体审查隔离项目',description:'测试',goal:'审查',scenario:'COMPETITION',deadline:new Date('2026-10-10')}});
 const proposal=await preview(p.id,{text:'团队准备做性能回归测试。',meetingDate:'2026-09-14'});
 const input={proposalId:proposal.proposalId,sourceTextHash:proposal.sourceTextHash,proposalVersion:proposal.proposalVersion,selectedChangeIds:proposal.typedChanges.filter(x=>x.kind==='ACTION_CREATE').map(x=>x.changeId)};
 const runs=await Promise.allSettled([confirm(p.id,input),confirm(p.id,input)]);
 results.concurrentMeeting={selected:input.selectedChangeIds,runs:runs.map(x=>x.status==='fulfilled'?{status:x.status,value:x.value}:{status:x.status,error:String(x.reason)}),actionCount:await db.actionItem.count({where:{projectId:p.id}})};
 const deadline=await preview(p.id,{text:'截止时间提前到2026-10-01。',meetingDate:'2026-09-14'});
 await db.project.update({where:{id:p.id},data:{deadline:new Date('2026-10-20')}});
 const confirmed=await confirm(p.id,{proposalId:deadline.proposalId,sourceTextHash:deadline.sourceTextHash,proposalVersion:deadline.proposalVersion,selectedChangeIds:deadline.typedChanges.filter(x=>x.kind==='DEADLINE_CHANGE').map(x=>x.changeId)});
 results.staleDeadline={newerValue:'2026-10-20',after:(await db.project.findUniqueOrThrow({where:{id:p.id}})).deadline,confirmed};
 const a=await db.actionItem.create({data:{projectId:p.id,title:'待开展行动'}});
 const b=await db.actionItem.create({data:{projectId:p.id,title:'尚未完成前置'}});
 await update(p.id,{actionId:a.id,addRequirements:[{targetKind:'action',targetId:b.id,hard:true}]});
 const req=await db.actionRequirement.findFirstOrThrow({where:{actionId:a.id}});
 results.replaceRequirement=await update(p.id,{actionId:a.id,removeRequirementIds:[req.id],addRequirements:[{targetKind:'action',targetId:b.id,hard:true,note:'修改备注'}]});
 console.log(JSON.stringify(results));
}finally{fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(results,null,2));await db.$disconnect();}
