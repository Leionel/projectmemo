/**
 * V2 routing evaluation executor (Slice B).
 *
 * It maps the frozen 64 routing cases onto real isolated SQLite records, runs the
 * production router + Mission runner / control services, collects tool traces from
 * real dispatch rows and persisted outcomes, and writes one JSON line per case.
 * Frozen expectations are never read here; the frozen scorer judges the output.
 *
 *   npm.cmd exec tsx -- scripts/eval-routes.ts [--out <dir>] [--review-bundle]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex >= 0 ? path.resolve(process.argv[outIndex + 1]) : path.resolve("evidence/v2-first-loop/routing", new Date().toISOString().replace(/[:.]/g, "-"));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-v2-routes-"));
const databaseFile = path.join(tempDir, "routes.db");
Object.assign(process.env, {
  DATABASE_URL: "file:" + databaseFile.replaceAll("\\", "/"), LLM_MODE: "mock",
  MISSION_ENABLED: "true", MISSION_V2_ENABLED: "true", MISSION_INVESTIGATION_DELEGATION_ENABLED: "true",
  MISSION_WORKBENCH_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true",
});
const bootstrap = new Database(databaseFile);
bootstrap.pragma("journal_mode = WAL");
for (const name of fs.readdirSync("prisma/migrations").sort()) {
  const migrationFile = path.join("prisma/migrations", name, "migration.sql");
  if (fs.existsSync(migrationFile)) bootstrap.exec(fs.readFileSync(migrationFile, "utf8"));
}
bootstrap.close();

const { db } = await import("@/lib/db");
const { Prisma } = await import("@/lib/generated/prisma/client");
const { routeSkillRequest } = await import("@/lib/skills/router");
const { installRequestRoute } = await import("@/lib/skills/runtime");
const { runMissionSlice } = await import("@/lib/mission/runner");
const { fixtureSkillProvider } = await import("./fixtures/v2-provider");
const { materializeFixture, routingInputFor, createFixtureMission, datasetFixtureIds } = await import("@/lib/evaluation/fixtures");
const { runCheck, DETERMINISTIC_CHECK_NAMES, TOOL_BOUNDARY_CHECKS } = await import("@/lib/evaluation/checks");
const { effectClassOf } = await import("@/lib/evaluation/toolEffects");
const { assertOwner } = await import("@/lib/mission/repository");
const { commandMission } = await import("@/lib/mission/missionService");
const { createSession } = await import("@/lib/auth/session");
const { createConversation } = await import("@/lib/conversation/service");
const { submitDirective } = await import("@/lib/continuity/directiveService");
const { jsonHash } = await import("@/lib/mission/contracts");
const { record } = await import("@/lib/conversation/repository");
const { readSkillArtifacts } = await import("@/lib/skills/artifacts");
const reviewBundle = process.argv.includes("--review-bundle") ? await import("@/lib/evaluation/routeReview") : null;
import type { CaseRun } from "@/lib/evaluation/checks";
import type { AgentMissionOutput } from "@/lib/generated/prisma/client";
import type { SkillRouteDecision } from "@/lib/skills/router";

type FrozenCase = { caseId: string; group: string; input: { fixtureId: string; message: string; event: string } };
type FixtureRefs = Awaited<ReturnType<typeof materializeFixture>>;
const datasetFile = path.resolve("docs/v2/evaluation/skill-routing.v1.json");
const rawDataset = fs.readFileSync(datasetFile, "utf8").replace(/^\uFEFF/, "");
const dataset = JSON.parse(rawDataset) as { datasetId: string; fixtures: Record<string, { missionId?: string | null }>; cases: FrozenCase[] };
const datasetFingerprint = createHash("sha256").update(rawDataset).digest("hex");
const fixtureIds = new Set(datasetFixtureIds());
for (const testCase of dataset.cases) if (!fixtureIds.has(testCase.input.fixtureId)) throw new Error("FIXTURE_NOT_MAPPED:" + testCase.caseId + ":" + testCase.input.fixtureId);

const missionRefOf = (fixtureId: string) => dataset.fixtures[fixtureId]?.missionId ?? null;

async function countOutputs(missionId: string | null) { return missionId ? db.agentMissionOutput.count({ where: { missionId } }) : 0; }

function outputCitations(output: Pick<AgentMissionOutput, "contentJson" | "sourceRefsJson"> | null) {
  const content = output?.contentJson as { blocks?: Array<{ text?: string; citations?: Array<{ sourceId?: string }> }> } | undefined;
  const sources = (output?.sourceRefsJson as Array<{ id: string; hash: string }> | null) ?? [];
  const keys = new Map(sources.map(source => [source.id, source.id + "@" + source.hash]));
  return { outputText: content?.blocks?.map(block => block.text ?? "").join("\n") ?? "",
    cited: [...new Set(content?.blocks?.flatMap(block => (block.citations ?? []).map(citation =>
      keys.get(citation.sourceId ?? "") ?? "unresolved:" + citation.sourceId)) ?? [])],
    refs: [...keys.values()] };
}

function baseRun(testCase: FrozenCase, refs: FixtureRefs, decision: SkillRouteDecision, outputsBefore: number, missionStatusBefore: string | null): CaseRun {
  return {
    caseId: testCase.caseId, decision, fixtureMissionRef: missionRefOf(testCase.input.fixtureId), missionRealId: refs.missionId,
    outputsBefore, outputsAfter: outputsBefore, steps: [], events: [], missionStatusBefore, missionStatusAfter: missionStatusBefore,
    control: { modelRunsBeforeDirective: 0, modelRunsAfterDirective: 0 },
    evidence: { entered: [], handoffs: 0, checkpoint: false },
    artifacts: { receiptsBefore: refs.artifactReceiptCount, receiptsAfter: refs.artifactReceiptCount, artifactHashBefore: null, artifactHashAfter: null },
    actions: { before: 0, after: 0 }, persisted: { settings: { provider: "INJECTED_V2_FIXTURE", mode: "OFFLINE_FIXTURE" } },
    outputText: "", citations: { cited: [], refs: [], previous: [] },
  };
}

async function executeRun(testCase: FrozenCase, refs: FixtureRefs, decision: SkillRouteDecision): Promise<CaseRun> {
  const missionBefore = refs.missionId ? await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } }) : null;
  const run = baseRun(testCase, refs, decision, await countOutputs(refs.missionId), missionBefore?.status ?? null);
  run.artifacts.artifactHashBefore = refs.artifactId ? (await db.generatedArtifact.findUniqueOrThrow({ where: { id: refs.artifactId } })).content : null;
  if (!refs.projectId) {
    run.artifacts.artifactHashAfter = run.artifacts.artifactHashBefore;
    return run;
  }
  let missionId = refs.missionId;
  if (missionId && missionBefore && missionBefore.status === "WAITING_INPUT") {
    // A user request wakes the mission; scheduling fields are not changed by the evaluator.
    await db.agentMission.update({ where: { id: missionId }, data: { status: "READY", waitStateJson: Prisma.DbNull, nextAttemptAt: null } });
  }
  if (!missionId) missionId = await createFixtureMission(refs.ownerUserId, refs.projectId, testCase.input.message);
  run.missionRealId = missionId;
  const previousOutput = await db.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" } });
  run.actions.before = await db.actionItem.count({ where: { projectId: refs.projectId, isSimulated: false } });
  await installRequestRoute(missionId, decision, "EVALUATION_HARNESS");
  const pointers = refs.sources.filter(source => source.kind === "PROJECT").map(source => ({ sourceId: source.id, sourceHash: source.hash }));
  const provider = fixtureSkillProvider(async () => pointers, { terminalArtifacts: true });
  for (let index = 0; index < 6; index++) {
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    if (before.status !== "READY") break;
    if (!await runMissionSlice({ id: missionId, provider })) break;
  }
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const steps = await db.agentMissionStep.findMany({ where: { missionId }, orderBy: { ordinal: "asc" } });
  const events = await db.agentMissionEvent.findMany({ where: { missionId }, orderBy: { seq: "asc" } });
  const latestOutput = await db.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" } });
  const artifactIds = new Set(readSkillArtifacts(mission.planJson).map(artifact => artifact.id));
  const artifactByStep = new Map(events.filter(row => row.type === "SKILL_DELIVERABLE_READY").map(row => {
    const payload = record(row.payloadJson);
    return [String(payload.stepId), String(payload.artifactId)];
  }));
  run.steps = steps.map(step => {
    const artifact = artifactByStep.get(step.id);
    const persisted = record(record(step.resultJson).data).artifactId;
    const stageArtifactId = step.status === "SUCCEEDED" && artifact && artifact === persisted && artifactIds.has(artifact) ? artifact : undefined;
    return { tool: step.toolName, status: step.status, effectClass: effectClassOf(step.toolName), stageArtifactId };
  });
  run.events = events.map(event => ({ type: event.type, payload: event.payloadJson }));
  run.outputsAfter = await countOutputs(missionId);
  run.missionStatusAfter = mission.status;
  run.actions.after = await db.actionItem.count({ where: { projectId: refs.projectId, isSimulated: false } });
  run.artifacts.receiptsAfter = await db.missionArtifactReceipt.count({ where: { missionId } });
  run.artifacts.artifactHashAfter = refs.artifactId ? (await db.generatedArtifact.findUniqueOrThrow({ where: { id: refs.artifactId } })).content : null;
  const latestCitations = outputCitations(latestOutput);
  run.outputText = latestCitations.outputText;
  run.citations = { cited: latestCitations.cited, refs: latestCitations.refs, previous: outputCitations(previousOutput).cited };
  const cursor = (mission.planJson as { skillCursor?: { evidencePack?: { sources: unknown[]; unknowns: Array<{ kind: string; column: string }> } } }).skillCursor;
  run.evidence = {
    pack: cursor?.evidencePack ? { sources: cursor.evidencePack.sources.length, unknowns: cursor.evidencePack.unknowns } : undefined,
    entered: [...events.filter(event => event.type === "SKILL_ENTERED").map(event => String((event.payloadJson as { skillId?: string }).skillId ?? "")), ...events.filter(event => event.type === "SKILL_HANDOFF").map(event => String((event.payloadJson as { to?: string }).to ?? ""))],
    handoffs: events.filter(event => event.type === "SKILL_HANDOFF").length,
    checkpoint: events.some(event => event.type === "CHECKPOINT_REACHED"),
  };
  return run;
}

async function admissionRun(projectId: string | null, purpose: string, payload: unknown, status: "SUCCESS" | "FAILED" = "SUCCESS", fallbackReason?: string) {
  const row = await db.agentRun.create({ data: { projectId, runType: "CHAT", status, provider: "V2_ROUTER", fallbackReason, trace: { purpose, ...(payload as object) } } });
  return row.id;
}

async function recordRestriction(refs: FixtureRefs, message: string, operation: "SET" | "SUPPRESS_USE", sourceIds: string[], run: CaseRun) {
  if (!refs.projectId) return;
  const session = await createSession(refs.ownerUserId);
  const actor = { userId: refs.ownerUserId, sessionId: session.session.id };
  const conversation = await createConversation(actor, { requestId: "eval-c-" + randomUUID(), scope: "PROJECT", projectId: refs.projectId });
  const runsBefore = await db.agentRun.count({ where: { projectId: refs.projectId } });
  const commandId = "eval-directive-" + randomUUID();
  const user = await db.user.findUniqueOrThrow({ where: { id: refs.ownerUserId } });
  await submitDirective(actor, conversation.id, {
    commandId, expectedSeq: user.continuitySeq,
    scope: { projectId: refs.projectId, ...(refs.missionId ? { missionId: refs.missionId } : {}) },
    operation, quote: message, ...(operation === "SUPPRESS_USE" ? { sourceIds: sourceIds.filter(Boolean) } : {}),
    timezone: "Asia/Shanghai", admission: "LITERAL" as const,
  });
  const directiveEvents = await db.agentDirectiveEvent.findMany({ where: { ownerUserId: refs.ownerUserId, commandId } });
  const runsAfter = await db.agentRun.count({ where: { projectId: refs.projectId } });
  run.control.directive = { eventIds: directiveEvents.map(event => event.id), kind: directiveEvents[0]?.kind ?? "CONSTRAINT",
    sourceIds: directiveEvents.flatMap(event => event.sourceIdsJson as string[]) };
  run.control.modelRunsBeforeDirective = runsBefore;
  run.control.modelRunsAfterDirective = Math.max(0, runsAfter - runsBefore);
}

async function executeControl(testCase: FrozenCase, refs: FixtureRefs, decision: SkillRouteDecision): Promise<CaseRun> {
  const missionBefore = refs.missionId ? await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } }) : null;
  const run = baseRun(testCase, refs, decision, await countOutputs(refs.missionId), missionBefore?.status ?? null);
  if (decision.mode === "CONTROL" && decision.restrictions.pause && refs.missionId) {
    const stepsBefore = await db.agentMissionStep.count({ where: { missionId: refs.missionId } });
    await commandMission(refs.ownerUserId, refs.missionId, "pause", { requestId: "eval-pause", expectedVersion: missionBefore!.version });
    let workerClaimed = false;
    await runMissionSlice({ id: refs.missionId, tools: {}, onClaim: () => { workerClaimed = true; },
      provider: async () => { throw new Error("PAUSE_PROBE_UNEXPECTED_DECISION"); } });
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } });
    const stepsAfterPause = await db.agentMissionStep.count({ where: { missionId: refs.missionId } }) - stepsBefore;
    run.control.pause = { requestedAt: after.pauseRequestedAt?.toISOString() ?? null, statusAfter: after.status, stepsAfterPause, workerClaimed };
  } else if (decision.mode === "CONTROL" && decision.restrictions.sourceSuppression) {
    await recordRestriction(refs, testCase.input.message, "SUPPRESS_USE", [refs.sources[0]?.id ?? ""], run);
  } else if (decision.mode === "CONTROL" && decision.restrictions.attentionOnly && refs.missionId) {
    const preference = await db.goalQuestionPreference.upsert({
      where: { userId_missionId_questionId: { userId: refs.ownerUserId, missionId: refs.missionId, questionId: "*" } },
      create: { userId: refs.ownerUserId, missionId: refs.missionId, questionId: "*", mode: "STOP", contextHash: jsonHash({ purpose: "eval-attention", fixture: refs.fixtureId }) },
      update: { mode: "STOP", snoozedUntil: null },
    });
    run.control.attention = { id: preference.id, mode: preference.mode };
  } else if (decision.mode === "CLARIFY") {
    const projectId = refs.projectId ?? refs.candidateMissions[0]?.projectId ?? null;
    const runId = await admissionRun(projectId, "ROUTE_CLARIFY", { mode: decision.mode, reasonCode: decision.reasonCode, intentHash: decision.intentHash, fixtureId: refs.fixtureId });
    run.control.clarify = { runId, questions: 1 };
  } else if (decision.mode === "DENY") {
    let code = "NOT_DENIED";
    try { await assertOwner(refs.ownerUserId, refs.foreignProjectId ?? refs.projectId ?? ""); } catch (error) { code = String((error as { code?: string }).code ?? "FORBIDDEN"); }
    await admissionRun(refs.foreignProjectId, "ROUTE_DENY", { mode: decision.mode, reasonCode: decision.reasonCode, code, intentHash: decision.intentHash, fixtureId: refs.fixtureId }, "FAILED", code);
    run.control.denied = { code };
  } else if (decision.mode === "ANSWER") {
    const runId = await admissionRun(refs.projectId, "ROUTE_ANSWER", { mode: decision.mode, reasonCode: decision.reasonCode, intentHash: decision.intentHash, fixtureId: refs.fixtureId });
    run.control.answer = { runId };
  } else {
    await recordRestriction(refs, testCase.input.message, "SET", [], run);
  }
  const after = refs.missionId ? await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } }) : null;
  run.missionStatusAfter = after?.status ?? null;
  run.outputsAfter = await countOutputs(refs.missionId);
  run.events = refs.missionId ? (await db.agentMissionEvent.findMany({ where: { missionId: refs.missionId }, orderBy: { seq: "asc" } })).map(event => ({ type: event.type, payload: event.payloadJson })) : [];
  return run;
}

fs.mkdirSync(outDir, { recursive: true });
const results: Array<Record<string, unknown>> = [];
const reviewRows: string[] = [];
const dimension = { total: dataset.cases.length, dispatchCases: 0, dispatchedTools: 0, externalReadDispatches: 0, externalWriteDispatches: 0, businessWriteDispatches: 0, controlCasesWithDispatch: 0, contentJudgement: "UNVERIFIED" };
const started = Date.now();
let index = 0;
for (const testCase of dataset.cases) {
  index++;
  const caseStarted = Date.now();
  const refs = await materializeFixture(testCase.input.fixtureId);
  const input = await routingInputFor(refs, testCase.input.message, testCase.input.event);
  const decision = routeSkillRequest(input);
  const run = decision.mode === "RUN" ? await executeRun(testCase, refs, decision) : await executeControl(testCase, refs, decision);
  if (reviewBundle) {
    const evidence = await reviewBundle.readRouteReviewEvidence(refs, run);
    reviewRows.push(JSON.stringify({ caseId: testCase.caseId, group: testCase.group, request: testCase.input.message,
      fixture: testCase.input.fixtureId, datasetFingerprint, data: "SYNTHETIC_ONLY", provider: "INJECTED_V2_FIXTURE", ...evidence }));
  }
  const checks = DETERMINISTIC_CHECK_NAMES.map(name => runCheck(name, run));
  const boundary = checks.filter(check => TOOL_BOUNDARY_CHECKS.has(check.name));
  if (run.steps.length) dimension.dispatchCases++;
  dimension.dispatchedTools += run.steps.length;
  dimension.externalReadDispatches += run.steps.filter(step => step.effectClass === "EXTERNAL_READ").length;
  dimension.externalWriteDispatches += run.steps.filter(step => step.effectClass === "EXTERNAL_WRITE").length;
  dimension.businessWriteDispatches += run.steps.filter(step => step.effectClass === "BUSINESS_WRITE").length;
  if (decision.mode !== "RUN" && run.steps.length) dimension.controlCasesWithDispatch++;
  results.push({
    caseId: testCase.caseId, mode: decision.mode, primary: decision.primary, reasonCode: decision.reasonCode, sequence: decision.sequence,
    trace: {
      outputMissionId: run.fixtureMissionRef,
      tools: run.steps.map(step => ({ name: step.tool, effectClass: step.effectClass, stageArtifactId: step.stageArtifactId })),
      checks: checks.map(check => ({ name: check.name, passed: check.passed, judge: check.judge, evidenceRef: check.evidenceRef, detail: check.detail })),
    },
    dimensions: {
      route: { mode: decision.mode, primary: decision.primary, sequence: decision.sequence, reasonCode: decision.reasonCode, reuseMissionId: decision.reuseMissionId, evidenceGate: decision.evidenceGate, restrictions: decision.restrictions, handoffOn: decision.handoffOn, intentHash: decision.intentHash },
      toolBoundary: { passed: boundary.every(check => check.passed), checks: boundary },
      evidence: { missionId: run.missionRealId, outputsBefore: run.outputsBefore, outputsAfter: run.outputsAfter, missionStatus: run.missionStatusAfter, enteredSkills: run.evidence.entered, handoffs: run.evidence.handoffs, checkpoint: run.evidence.checkpoint, evidencePack: run.evidence.pack,
        pause: run.control.pause, citations: run.citations.previous.length ? run.citations : undefined },
    },
    provider: "INJECTED_V2_FIXTURE", fixtureHash: datasetFingerprint.slice(0, 16), durationMs: Date.now() - caseStarted,
  });
  process.stdout.write("[" + index + "/" + dataset.cases.length + "] " + testCase.caseId + " " + decision.mode + " " + JSON.stringify(decision.sequence) + "\n");
}
const resultsFile = path.join(outDir, "results.jsonl");
fs.writeFileSync(resultsFile, results.map(record => JSON.stringify(record)).join("\n") + "\n");
const reviewFile = reviewBundle ? path.join(outDir, "review-evidence.jsonl") : undefined;
if (reviewFile) fs.writeFileSync(reviewFile, reviewRows.join("\n") + "\n");
const report = {
  datasetId: dataset.datasetId, datasetFingerprint, generatedAt: new Date().toISOString(),
  provider: "INJECTED_V2_FIXTURE", modelCalls: 0, paidCalls: 0,
  cases: results.length, dimension, durationMs: Date.now() - started, resultsFile, reviewFile,
  note: "路由、工具边界与持久证据由真实 Router/Mission Runner/控制服务与真实 AgentMissionStep 采集；内容语义判据在离线注入模型下标记 UNPROVEN，不判真，按失败计入最终证据维度。",
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await db.$disconnect();
if (process.env.PM_KEEP_DB) console.log("TEMP_DB=" + databaseFile);
else try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* keep for inspection when locked */ }
