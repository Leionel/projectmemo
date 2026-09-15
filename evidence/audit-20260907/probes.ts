// Audit-only reproduction: actual backend code and transpiled service code with explicit platform stubs.
// Uses a fresh database per run; never reads or modifies the development database.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import Database from 'better-sqlite3';
import ts from 'typescript';

const out = path.resolve('evidence/audit-20260907');
const dbPath = path.join(out, `probe-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbPath.replaceAll('\\', '/')}`;
process.env.LLM_MODE = 'mock';
process.env.SEMANTIC_MEMORY_ENABLED = 'false';
process.env.TEMPORAL_MEMORY_ENABLED = 'false';
process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = 'true';
const sqlite = new Database(dbPath);
for (const name of fs.readdirSync('prisma/migrations').sort()) {
  const p = path.join('prisma/migrations', name, 'migration.sql');
  if (fs.existsSync(p)) sqlite.exec(fs.readFileSync(p, 'utf8'));
}
sqlite.close();
const results: Record<string, unknown> = { database: dbPath, scope: 'Local logic and route-handler probes; not an ArkUI or notification-system run' };

const { projectCreateSchema } = await import('../../lib/validation/schemas');
const base = { title: '审计隔离项目', description: '仅用于本次功能审查的隔离测试记录', goal: '验证边界契约', scenario: 'COMPETITION' };
const date = '2026-09-30';
results.deadlineContract = {
  calendarDateAccepted: projectCreateSchema.safeParse({ ...base, deadline: date }).success,
  appISODateAccepted: projectCreateSchema.safeParse({ ...base, deadline: new Date(date).toISOString() }).success,
  note: 'newDeadline currently has no UI setter; ISO mismatch is latent, not a reachable date-entry failure',
};

const { db } = await import('../../lib/db');
const { createProject } = await import('../../lib/repositories/projects');
const { createAction } = await import('../../lib/repositories/agent');
const { completeProjectAction } = await import('../../lib/services/actionService');
const { executeCopilotTool } = await import('../../lib/services/copilotService');
const project = await createProject(projectCreateSchema.parse(base));
const action = await createAction(project.id, { title: '并发完成审计行动' });
const completions = await Promise.allSettled([
  completeProjectAction(project.id, action.id, '完成第一份可核对的实验结果'),
  completeProjectAction(project.id, action.id, '完成第二份可核对的实验结果'),
]);
results.concurrentCompletion = {
  outcomes: completions.map(r => r.status === 'fulfilled' ? { status: r.status } : { status: r.status, reason: String(r.reason) }),
  reflectionCount: await db.knowledgeCard.count({ where: { projectId: project.id, type: 'reflection' } }),
  actionResultCardId: (await db.actionItem.findUnique({ where: { id: action.id } }))?.resultCardId,
};

const sourceRun = await db.agentRun.create({ data: {
  projectId: project.id, runType: 'CHAT', status: 'SUCCESS', provider: 'audit-fixture',
  trace: { supportState: 'SUPPORTED' },
  resultJson: { proposedActions: [{ kind: 'create_action', title: '同一建议重复确认', description: '原始建议说明', priority: 2 }] },
} });
const proposal = { tool: 'create_action' as const, confirmed: true, sourceRunId: sourceRun.id, payload: { title: '同一建议重复确认', description: '原始建议说明', priority: 2 } };
const first = await executeCopilotTool(project.id, proposal);
const second = await executeCopilotTool(project.id, proposal);
results.repeatedCopilotConfirmation = { firstId: first.result.id, secondId: second.result.id, count: await db.actionItem.count({ where: { projectId: project.id, title: '同一建议重复确认' } }) };

const changed = await executeCopilotTool(project.id, { ...proposal, payload: { title: '同一建议重复确认', description: '替换成未在原建议确认的内容', priority: 5 } });
results.proposalPayloadBinding = { changedDescription: (changed.result as { description?: string }).description, changedPriority: (changed.result as { priority?: number }).priority };

const projectsRoute = await import('../../app/api/projects/route');
const detailRoute = await import('../../app/api/projects/[id]/route');
const anonymousList = await projectsRoute.GET();
const anonymousDelete = await detailRoute.DELETE(new Request(`http://audit.invalid/api/projects/${project.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: project.id }) });
results.routeAuthenticationBoundary = { anonymousListStatus: anonymousList.status, anonymousDeleteStatus: anonymousDelete.status, note: 'Direct local route invocation bypasses Nginx; not evidence that a public endpoint is exposed.' };

const serviceSource = fs.readFileSync('harmonyos/entry/src/main/ets/services/NotificationService.ets', 'utf8');
const js = ts.transpileModule(serviceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let allow = false;
const calls: Record<string, unknown>[] = [];
const notificationManager = {
  isNotificationEnabled: async () => allow,
  requestEnableNotification: async () => {},
  cancel: async () => {},
  publish: async (r: Record<string, unknown>) => { calls.push(r); },
  SlotType: { OTHER_TYPES: 0 }, ContentType: { NOTIFICATION_CONTENT_BASIC_TEXT: 0 },
};
const wantAgent = { getWantAgent: async () => ({}), OperationType: { START_ABILITY: 0 }, WantAgentFlags: { UPDATE_PRESENT_FLAG: 0 } };
type NotificationServiceProbe = {
  scheduleInterventionNotification: (intervention: Record<string, unknown>, projectId: string, deliveryTime: number) => Promise<unknown>;
  publishInterventionNotification: (intervention: Record<string, unknown>, projectId: string) => Promise<unknown>;
};
const sandboxExports: Record<string, unknown> = {};
vm.runInNewContext(js, { exports: sandboxExports, require: (name: string) => name === '@kit.NotificationKit' ? { notificationManager } : { wantAgent }, console: { warn() {} }, Date });
const NotificationService = sandboxExports.NotificationService as new () => NotificationServiceProbe;
const service = new NotificationService();
const intervention = { id: 'audit-reminder', status: 'OPEN', severity: 5, title: '审计提醒', content: '审计内容' };
await service.scheduleInterventionNotification(intervention, 'audit-project', Date.now() + 86400000);
results.notificationDenied = { resolvedWithoutError: true, publishCalls: calls.length };
allow = true;
await service.publishInterventionNotification(intervention, 'audit-project');
results.notificationPermissionChanged = { platformEnabledNow: true, publishCallsAfterEnable: calls.length };
const freshService = new NotificationService();
await freshService.scheduleInterventionNotification(intervention, 'audit-project', Date.now() + 86400000);
results.notificationSchedule = { publishCalls: calls.length, futureDeliveryTimePassedImmediately: Number(calls[0]?.deliveryTime) > Date.now() };
await db.$disconnect();
fs.writeFileSync(path.join(out, 'probe-results.json'), JSON.stringify(results, null, 2) + '\n');
console.log(JSON.stringify(results, null, 2));
