import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
const dir = path.resolve('evidence/handover-audit-20260908');
const database = path.join(dir, `probe-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${database.replaceAll('\\', '/')}`;
process.env.LLM_MODE = 'mock';
process.env.SEMANTIC_MEMORY_ENABLED = 'false';
process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = 'true';
const sql = new Database(database);
for (const folder of fs.readdirSync('prisma/migrations').sort()) {
  const p = path.join('prisma/migrations', folder, 'migration.sql');
  if (fs.existsSync(p)) sql.exec(fs.readFileSync(p, 'utf8'));
}
sql.close();
const { db } = await import('../../lib/db');
const { analyzeChangeImpact, confirmChangeImpact } = await import('../../lib/services/changeImpactService');
const { executeCopilotTool } = await import('../../lib/services/copilotService');
const { completeProjectAction } = await import('../../lib/services/actionService');
const a = await db.project.create({ data: { title: '审计项目A', description: '隔离审计', goal: '审计', scenario: 'RESEARCH' } });
const b = await db.project.create({ data: { title: '审计项目B', description: '隔离审计', goal: '审计', scenario: 'RESEARCH' } });
async function card(projectId: string, title: string) {
  const capture = await db.capture.create({ data: { projectId, rawText: title } });
  return db.knowledgeCard.create({ data: { projectId, captureId: capture.id, title, summary: title, type: 'meeting_note', keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
}
const old = await card(a.id, '模型方案A');
const foreign = await card(b.id, '项目B独立决策');
const unrelated = await db.actionItem.create({ data: { projectId: a.id, title: '报销差旅费用', status: 'TODO' } });
const preview = await analyzeChangeImpact(a.id, '模型方案A改为方案B');
const forged = { proposalId: 'never-created-proposal', newFactText: '未经过预览的直接提交', supersededCardId: foreign.id, cancelledActionIds: [], newActions: [] };

let bogusProposalAccepted = false;
let crossProjectRelationCreated = false;
try {
  const bogusResult = await confirmChangeImpact(a.id, forged);
  bogusProposalAccepted = Boolean(bogusResult?.success);
  if (bogusResult?.newCardId) {
    const rel = await db.cardRelation.findFirst({ where: { currentCardId: bogusResult.newCardId, relatedCardId: foreign.id } });
    if (rel) crossProjectRelationCreated = true;
  }
} catch {
  bogusProposalAccepted = false;
}

// 探测真实提案在重复提交时的幂等性与卡片复用
const validFirst = await confirmChangeImpact(a.id, {
  proposalId: preview.proposalId,
  newFactText: '模型方案A改为方案B并通过真实提案提交',
  supersededCardId: old.id,
});
const validSecond = await confirmChangeImpact(a.id, {
  proposalId: preview.proposalId,
  newFactText: '模型方案A改为方案B并通过真实提案提交',
  supersededCardId: old.id,
});
const repeatedChangeCreatesDifferentCards = validFirst.newCardId !== validSecond.newCardId;

const proposal = { kind: 'create_action', title: '并发确认同一个提案', priority: 2 };
const run = await db.agentRun.create({ data: { projectId: a.id, runType: 'CHAT', status: 'SUCCESS', provider: 'audit', trace: { supportState: 'SUPPORTED' }, resultJson: { proposedActions: [proposal] } } });
const input = { tool: 'create_action' as const, confirmed: true, sourceRunId: run.id, payload: { title: proposal.title, priority: 5 } };
const concurrent = await Promise.allSettled([executeCopilotTool(a.id, input), executeCopilotTool(a.id, input)]);
const action = await db.actionItem.create({ data: { projectId: a.id, title: '完成幂等回归', status: 'TODO' } });
const completed = await Promise.allSettled([completeProjectAction(a.id, action.id, '完成一次真实实验结果'), completeProjectAction(a.id, action.id, '完成一次真实实验结果')]);
const clean = await db.project.create({ data: { title: '干净回归项目', description: '隔离审计', goal: '审计', scenario: 'RESEARCH' } });
const cleanAction = await db.actionItem.create({ data: { projectId: clean.id, title: '干净项目完成回归', status: 'TODO' } });
const cleanCompleted = await Promise.allSettled([completeProjectAction(clean.id, cleanAction.id, '完成一次真实实验结果'), completeProjectAction(clean.id, cleanAction.id, '完成一次真实实验结果')]);
const result = {
  scope: 'Isolated backend logic, no production DB or platform UI', database,
  unrelatedActionMarkedForCancellation: preview.impactedActions.some(x => x.targetId === unrelated.id),
  bogusProposalAccepted,
  crossProjectRelationCreated,
  repeatedChangeCreatesDifferentCards,
  copilotConcurrentOutcomes: concurrent.map(x => x.status),
  copilotDuplicateCount: await db.actionItem.count({ where: { projectId: a.id, title: proposal.title } }),
  copilotSavedPriorities: (await db.actionItem.findMany({ where: { projectId: a.id, title: proposal.title } })).map(x => x.priority),
  completeOutcomes: completed.map(x => x.status === 'rejected' ? { status: x.status, reason: String(x.reason) } : { status: x.status }),
  reflectionCount: await db.knowledgeCard.count({ where: { projectId: a.id, type: 'reflection' } }),
  cleanCompleteOutcomes: cleanCompleted.map(x => x.status === 'rejected' ? { status: x.status, reason: String(x.reason) } : { status: x.status }),
  cleanReflectionCount: await db.knowledgeCard.count({ where: { projectId: clean.id, type: 'reflection' } }),
};
await db.$disconnect();
fs.writeFileSync(path.join(dir, 'probe-results.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
