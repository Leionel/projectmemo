/**
 * P0-A: actual Node OS workers + SQLite, with ONLY model HTTP responses mocked.
 * Run: node --import tsx evidence/p0-a/worker-os-probe.mjs
 * Creates a fresh OS-temp database; never loads .env in this coordinator.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert.equal(process.cwd(), root, 'Run from the ProjectMemo root');
const runtimeFiles = ['scripts/mission-worker.ts', 'lib/mission/runner.ts', 'lib/mission/modelAdapter.ts', 'lib/mission/runtimeStore.ts'];
const sourceHashes = () => Object.fromEntries(runtimeFiles.map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
const runtimeSourceHashes = sourceHashes();
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = path.join(root, 'evidence/p0-a/worker-os', stamp);
fs.mkdirSync(output, { recursive: true });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'projectmemo-p0a-os-'));
const databaseFile = path.join(temporary, 'workers.db');
const databaseUrl = `file:${databaseFile.replaceAll('\\', '/')}`;
assert.notEqual(databaseFile, path.join(root, 'prisma/test-vitest.db'));
const sql = new Database(databaseFile);
for (const dir of fs.readdirSync(path.join(root, 'prisma/migrations')).sort()) {
  const file = path.join(root, 'prisma/migrations', dir, 'migration.sql');
  if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, 'utf8'));
}
sql.close();
Object.assign(process.env, { DATABASE_URL: databaseUrl, MISSION_ENABLED: 'true', MISSION_WRITES_ENABLED: 'true',
  MISSION_EVENT_CONTINUATION_ENABLED: 'false', MISSION_AUTO_CONTINUATION_ENABLED: 'false',
  MISSION_CLAIM_JUDGE_ENABLED: 'false', MISSION_SEMANTIC_CHECK_ENABLED: 'false' });
const { db } = await import('../../lib/db.ts');
const { createMission, commandMission, missionDetail } = await import('../../lib/mission/missionService.ts');
const owner = await db.user.create({ data: { username: `os-probe-${randomUUID()}`, displayName: 'OS隔离探针', passwordHash: 'unused-fixture-only' } });
const processes = [];
const calls = [];
const cases = [];
const held = new Map();
let crashCanContinue = false;
let activeMission;
const reply = (response, choice) => {
  if (response.destroyed) return;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(choice) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
};
const tool = (name, args = {}) => ({ kind: 'tool', tool: name, args, summary: '隔离OS探针' });
const draft = () => tool('save_mission_output', { blocks: [{ blockId: 'probe-note', kind: 'INFERENCE', text: '本内容仅为独立进程可靠性探针，不代表真实模型或现实任务结果。', sourceIds: [] }] });
const server = http.createServer(async (request, response) => {
  try {
    assert.equal(request.url, '/v1/chat/completions');
    assert.ok(request.headers.authorization === 'Bearer p0a-local-fixture-not-a-secret', 'Only local fixture credentials are accepted');
    let body = '';
    for await (const chunk of request) { body += chunk; assert.ok(body.length < 100000); }
    const payload = JSON.parse(body);
    const context = JSON.parse(payload.messages.find(message => message.role === 'user').content).context;
    assert.equal(context.goal, activeMission.goal);
    const entry = { case: activeMission.caseName, call: calls.length + 1, at: new Date().toISOString(), action: 'held' };
    calls.push(entry);
    if (activeMission.caseName === 'race' || activeMission.caseName === 'fence') {
      const group = held.get(activeMission.caseName) ?? [];
      group.push({ response, entry }); held.set(activeMission.caseName, group);
    } else if (!crashCanContinue) {
      if (await db.agentMissionApproval.count({ where: { missionId: activeMission.id } }) === 0) {
        entry.action = 'propose_action'; reply(response, tool('propose_action', { title: 'OS探针需人工批准的待办', priority: 3 }));
      } else {
        held.set('crash', [{ response, entry }]);
      }
    } else {
      const saved = await db.agentMissionOutput.findFirst({ where: { missionId: activeMission.id }, orderBy: { revision: 'desc' } });
      entry.action = saved ? 'finish' : 'save_mission_output';
      reply(response, saved ? { kind: 'finish', outputId: saved.id } : draft());
    }
  } catch (error) { response.writeHead(500); response.end(JSON.stringify({ error: error.message })); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.equal(typeof address, 'object');
const environment = { ...process.env, DOTENV_CONFIG_PATH: path.join(temporary, 'nonexistent.env'),
  LLM_MODE: 'openai-compatible', LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  LLM_MODEL_NAME: 'P0A_LOCAL_HTTP_FIXTURE', LLM_API_KEY: 'p0a-local-fixture-not-a-secret', LLM_TIMEOUT_MS: '20000',
  MISSION_MODEL_PROTOCOL: 'json', DATABASE_URL: databaseUrl };

function startWorker(label, once = true) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/mission-worker.ts', ...(once ? ['--once'] : [])], {
    cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { label, pid: child.pid, exited: false, code: null, signal: null, child, log: '' };
  record.finished = new Promise(resolve => {
    child.on('error', error => { record.log += `spawn: ${error.message}\n`; });
    child.on('exit', (code, signal) => { record.exited = true; record.code = code; record.signal = signal; resolve(); });
  });
  child.stdout.on('data', value => { record.log += value; });
  child.stderr.on('data', value => { record.log += value; });
  processes.push(record); return record;
}
async function until(check, label, milliseconds = 20000) {
  const end = Date.now() + milliseconds;
  while (Date.now() < end) { const result = await check(); if (result) return result; await delay(100); }
  throw new Error(`Timed out: ${label}`);
}
async function finishWorker(worker, allowKill = false) {
  await until(() => worker.exited, `worker ${worker.label} exit`, 15000);
  if (!allowKill) assert.equal(worker.code, 0, worker.log);
}
async function fixture(caseName, successCriteria = ['DRAFT_EXISTS']) {
  const project = await db.project.create({ data: { title: `P0-A ${caseName}`, description: 'OS processes / local model fixture', goal: '验证持久执行边界', scenario: 'RESEARCH' } });
  await db.projectMembership.create({ data: { userId: owner.id, projectId: project.id, role: 'OWNER' } });
  const mission = await createMission(owner.id, { projectId: project.id, requestId: randomUUID(), goal: `P0-A ${caseName} ${randomUUID()}`, llmContextApproved: true, successCriteria });
  activeMission = { ...mission, caseName };
  return activeMission;
}
async function cancel(mission) {
  const current = await missionDetail(owner.id, mission.id);
  await commandMission(owner.id, mission.id, 'cancel', { requestId: randomUUID(), expectedVersion: current.version });
}
const startedAt = new Date().toISOString();
let failure;
try {
  // Two actual OS workers contend; only the winner reaches the model endpoint.
  const race = await fixture('race');
  const a = startWorker('race-a'), b = startWorker('race-b');
  await until(() => held.get('race')?.length === 1, 'first race provider request');
  await until(() => a.exited || b.exited, 'contending worker observes occupied execution slot');
  const claim = await db.agentMission.findUniqueOrThrow({ where: { id: race.id } });
  assert.equal(claim.status, 'RUNNING'); assert.equal(claim.executionSlot, 1);
  held.get('race')[0].entry.action = 'inspect_project'; reply(held.get('race')[0].response, tool('inspect_project'));
  await Promise.all([finishWorker(a), finishWorker(b)]);
  const raceClaims = await db.agentMissionEvent.count({ where: { missionId: race.id, type: 'CLAIMED' } });
  assert.equal(raceClaims, 1); assert.equal(calls.filter(call => call.case === 'race').length, 1);
  assert.equal(await db.agentMissionStep.count({ where: { missionId: race.id, status: 'SUCCEEDED' } }), 1);
  cases.push({ name: 'two_os_workers_one_lease', passed: true, pids: [a.pid, b.pid], claimCount: raceClaims, providerRequests: 1 });
  await cancel(race);

  // Keep one worker alive across its heartbeat, then inject lease expiry to test an old response.
  const fence = await fixture('fence');
  const stale = startWorker('fence-old');
  await until(() => held.get('fence')?.length === 1, 'old lease provider request');
  const old = await db.agentMission.findUniqueOrThrow({ where: { id: fence.id } });
  const renewed = await until(async () => {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: fence.id } });
    return row.leaseUntil > old.leaseUntil ? row : null;
  }, 'actual 10-second heartbeat renews lease', 14000);
  await db.agentMission.update({ where: { id: fence.id }, data: { leaseUntil: new Date(0) } });
  const fresh = startWorker('fence-new');
  await until(() => held.get('fence')?.length === 2, 'new owner obtains expired lease');
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: fence.id } });
  assert.ok(current.leaseEpoch > old.leaseEpoch); assert.notEqual(current.leaseOwner, old.leaseOwner);
  held.get('fence')[1].entry.action = 'inspect_project'; reply(held.get('fence')[1].response, tool('inspect_project'));
  await finishWorker(fresh);
  held.get('fence')[0].entry.action = 'stale_propose_action_must_be_rejected';
  reply(held.get('fence')[0].response, tool('propose_action', { title: '过期执行器不得提交的提案' }));
  await finishWorker(stale);
  const fenceSteps = await db.agentMissionStep.findMany({ where: { missionId: fence.id } });
  assert.deepEqual(fenceSteps.map(step => step.toolName), ['inspect_project']);
  assert.equal(await db.agentMissionApproval.count({ where: { missionId: fence.id } }), 0);
  assert.equal(await db.actionItem.count({ where: { projectId: fence.projectId } }), 0);
  cases.push({ name: 'heartbeat_and_old_owner_fence', passed: true, pids: [stale.pid, fresh.pid],
    expiryFaultInjection: true, originalLeaseUntil: old.leaseUntil, renewedLeaseUntil: renewed.leaseUntil,
    oldEpoch: old.leaseEpoch, newEpoch: current.leaseEpoch, durableTools: fenceSteps.map(step => step.toolName), staleWrites: 0 });
  await cancel(fence);

  // Commit an approved Action, kill the real worker on its next model call, and
  // let a replacement wait for the real 60-second lease expiry (no time injection).
  const crash = await fixture('crash', ['ACTION_CREATED', 'DRAFT_EXISTS']);
  await finishWorker(startWorker('approval-proposal'));
  const pending = await missionDetail(owner.id, crash.id);
  assert.equal(pending.status, 'WAITING_APPROVAL');
  await commandMission(owner.id, crash.id, 'approval', { requestId: randomUUID(), expectedVersion: pending.version,
    decision: 'APPROVED', proposalHash: pending.approvals[0].proposalHash }, pending.approvals[0].id);
  const killed = startWorker('crash-after-approved-action', false);
  await until(() => held.has('crash'), 'action committed before held model decision');
  assert.equal(await db.actionItem.count({ where: { projectId: crash.projectId } }), 1);
  assert.equal(await db.agentMissionApproval.count({ where: { missionId: crash.id, status: 'CONSUMED' } }), 1);
  const beforeKill = await db.agentMission.findUniqueOrThrow({ where: { id: crash.id } });
  const killedAt = new Date().toISOString(); killed.child.kill('SIGKILL'); await finishWorker(killed, true);
  crashCanContinue = true;
  const recovery = startWorker('crash-replacement', false);
  await until(async () => (await db.agentMission.findUniqueOrThrow({ where: { id: crash.id } })).status === 'SUCCEEDED', 'natural lease expiry and replacement completes', 80000);
  recovery.child.kill('SIGTERM'); await finishWorker(recovery, true);
  const complete = await missionDetail(owner.id, crash.id);
  const actions = await db.actionItem.findMany({ where: { projectId: crash.projectId } });
  assert.equal(actions.length, 1); assert.equal(actions[0].status, 'TODO'); assert.equal(actions[0].resultCardId, null);
  assert.equal(complete.outputs.length, 1); assert.equal(complete.completion.criteriaPassed, true);
  assert.equal(complete.completion.draftVerification, 'NEEDS_REVIEW'); assert.equal(complete.completion.adoptionCount, 0);
  assert.equal(complete.completion.realityOutcome, 'NOT_INFERRED');
  assert.equal(await db.agentMissionEvent.count({ where: { missionId: crash.id, type: 'ACTION_CREATED' } }), 1);
  const allEvents = await db.agentMissionEvent.findMany({ where: { missionId: crash.id }, orderBy: { seq: 'asc' } });
  assert.equal(new Set(allEvents.map(event => event.seq)).size, allEvents.length);
  const reclaimed = allEvents.find(event => event.type === 'CLAIMED' && event.payloadJson.epoch > beforeKill.leaseEpoch);
  assert.ok(reclaimed, 'A replacement must acquire a newer lease epoch');
  assert.ok(reclaimed.createdAt >= beforeKill.leaseUntil, 'Replacement must wait for the real persisted TTL');
  assert.equal(await db.agentMissionApproval.count({ where: { missionId: crash.id, status: 'CONSUMED' } }), 1);
  cases.push({ name: 'os_kill_natural_expiry_recovery_no_duplicate_action', passed: true, pids: [killed.pid, recovery.pid],
    killedAt, originalLeaseUntil: beforeKill.leaseUntil, reclaimedAt: reclaimed.createdAt, recoveredAt: new Date().toISOString(), expiryFaultInjection: false,
    oldEpoch: beforeKill.leaseEpoch, newEpoch: reclaimed.payloadJson.epoch,
    actionCount: actions.length, actionStatus: actions[0].status, resultCardId: null, actionCreatedEventCount: 1,
    outputCount: complete.outputs.length, completion: complete.completion, monotonicUniqueEventSeq: true });
} catch (error) {
  failure = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  for (const worker of processes) if (!worker.exited) worker.child.kill('SIGKILL');
  await Promise.all(processes.map(worker => worker.finished));
  for (const worker of processes) fs.writeFileSync(path.join(output, `${worker.label}.log`), worker.log);
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await db.$disconnect();
  const runtimeSourcesUnchanged = JSON.stringify(sourceHashes()) === JSON.stringify(runtimeSourceHashes);
  if (!runtimeSourcesUnchanged && !failure) { failure = { message: 'Runtime source changed during the probe; rerun required' }; process.exitCode = 1; }
  const result = { startedAt, finishedAt: new Date().toISOString(), passed: !failure, provider: 'LOCAL_HTTP_MOCK', realModelRequests: 0,
    database: databaseFile, temporaryDatabaseRetained: true, sharedVitestDatabaseUsed: false, realOSProcesses: true,
    workerEntry: 'scripts/mission-worker.ts', runtimeReimplemented: false, runtimeSourceHashes, runtimeSourcesUnchanged, calls, cases,
    processes: processes.map(({ label, pid, code, signal }) => ({ label, pid, code, signal })), ...(failure ? { failure } : {}) };
  fs.writeFileSync(path.join(output, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: result.passed, output, cases: cases.map(item => item.name), failure }, null, 2)}\n`);
}
