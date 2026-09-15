import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const dir=path.resolve('evidence/review123-20260914');
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
const {POST}=await import('../../app/api/projects/[id]/captures/route');
const {POST:refresh}=await import('../../app/api/projects/[id]/state/refresh/route');
try{
 const p=await db.project.create({data:{title:'审查123隔离项目',description:'测试',goal:'审查',scenario:'COMPETITION'}});
 const ctx={params:Promise.resolve({id:p.id})};
 const payload={rawText:'审查123：录入成功但响应丢失后重试',sourceType:'随手记录'};
 const req=()=>new Request('http://local/api/projects/'+p.id+'/captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
 const first=await POST(req(),ctx); const firstBody=await first.json();
 const second=await POST(req(),ctx); const secondBody=await second.json();
 const state=await refresh(new Request('http://local',{method:'POST'}),ctx);
 const result={firstStatus:first.status,secondStatus:second.status,firstCard:firstBody.card?.id,secondCard:secondBody.card?.id,cardCount:await db.knowledgeCard.count({where:{projectId:p.id}}),refreshStatus:state.status,refreshBody:await state.json()};
 fs.writeFileSync(path.join(dir,'results.json'),JSON.stringify(result,null,2));
 console.log(JSON.stringify({firstStatus:result.firstStatus,secondStatus:result.secondStatus,firstCard:result.firstCard,secondCard:result.secondCard,cardCount:result.cardCount,refreshStatus:result.refreshStatus}));
}finally{await db.$disconnect();}
