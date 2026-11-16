/**
 * V2 routing evaluation executor (Slice B).
 *
 * It maps the frozen 64 routing cases onto real isolated SQLite records, runs the
 * production router + Mission runner / control services, collects tool traces from
 * real dispatch rows and persisted outcomes, and writes one JSON line per case.
 * Frozen expectations are never read here; the frozen scorer judges the output.
 *
 *   npm.cmd exec tsx -- scripts/eval-routes.ts [--out <dir>]
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
import type { CaseRun } from "@/lib/evaluation/checks";
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

function baseRun(testCase: FrozenCase, refs: FixtureRefs, decision: SkillRouteDecision, outputsBefore: number, missionStatusBefore: string | null): CaseRun {
  return {
    caseId: testCase.caseId, decision, fixtureMissionRef: missionRefOf(testCase.input.fixtureId), missionRealId: refs.missionId,
    outputsBefore, outputsAfter: outputsBefore, steps: [], events: [], missionStatusBefore, missionStatusAfter: missionStatusBefore,
    control: { modelRunsBeforeDirective: 0, modelRunsAfterDirective: 0 },
    evidence: { entered: [], handoffs: 0, checkpoint: false },
    artifacts: { receiptsBefore: refs.artifactReceiptCount, receiptsAfter: refs.artifactReceiptCount, artifactHashBefore: null, artifactHashAfter: null },
    actions: { before: 0, after: 0 }, persisted: { settings: { provider: "INJECTED_V2_FIXTURE", mode: "OFFLINE_FIXTURE" } },
    outputText: "", citations: { cited: [], refs: [] },
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
  await installRequestRoute(missionId, decision, "EVALUATION_HARNESS");
  const projectSourceCount = (await db.capture.count({ where: { projectId: refs.projectId } })) + (await db.attachment.count({ where: { projectId: refs.projectId } }));
  const pointers = refs.sources.filter(source => source.kind === "PROJECT").map(source => ({ sourceId: source.id, sourceHash: source.hash }));
  const provider = fixtureSkillProvider(async () => pointers);
  for (let index = 0; index < 6; index++) {
    const before = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    if (before.status !== "READY") break;
    await runMissionSlice({ id: missionId, provider });
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    const cursor = (after.planJson as { skillCursor?: { stage: string; stageIndex: number; sequence: string[]; evidencePack?: { sources: unknown[] } } }).skillCursor;
    if (!cursor) break;
    const lastStage = cursor.stageIndex === cursor.sequence.length - 1 && cursor.stage !== "deliverable-creation";
    if (lastStage) {
      const stagePacks = (await db.agentMissionEvent.findMany({ where: { missionId, type: "SKILL_EVIDENCE_PACK" }, select: { payloadJson: true } }))
        .filter(event => (event.payloadJson as { skillId?: string }).skillId === cursor.stage).length;
      const packSources = cursor.evidencePack?.sources.length ?? 0;
      const researchNeedsMore = cursor.stage === "evidence-research" && packSources < Math.min(projectSourceCount, 4);
      if (stagePacks > 0 && !researchNeedsMore) break;
    }
  }
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const steps = await db.agentMissionStep.findMany({ where: { missionId }, orderBy: { ordinal: "asc" } });
  const events = await db.agentMissionEvent.findMany({ where: { missionId }, orderBy: { seq: "asc" } });
  const latestOutput = await db.agentMissionOutput.findFirst({ where: { missionId }, orderBy: { revision: "desc" } });
  run.steps = steps.map(step => ({ tool: step.toolName, status: step.status, effectClass: effectClassOf(step.toolName) }));
  run.events = events.map(event => ({ type: event.type, payload: event.payloadJson }));
  run.outputsAfter = await countOutputs(missionId);
  run.missionStatusAfter = mission.status;
  run.actions.after = await db.actionItem.count({ where: { projectId: refs.projectId, isSimulated: false } });
  run.artifacts.receiptsAfter = await db.missionArtifactReceipt.count({ where: { missionId } });
  run.artifacts.artifactHashAfter = refs.artifactId ? (await db.generatedArtifact.findUniqueOrThrow({ where: { id: refs.artifactId } })).content : null;
  const content = latestOutput ? (latestOutput.contentJson as { blocks?: Array<{ text?: string; citations?: Array<{ sourceId?: string }> }> }) : undefined;
  run.outputText = content?.blocks?.map(block => block.text ?? "").join("\n") ?? "";
  run.citations = {
    cited: content?.blocks?.flatMap(block => (block.citations ?? []).map(citation => String(citation.sourceId ?? ""))) ?? [],
    refs: ((latestOutput?.sourceRefsJson as Array<{ id?: string }> | null) ?? []).map(source => String(source.id ?? "")),
  };
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
    await commandMission(refs.ownerUserId, refs.missionId, "pause", { requestId: "eval-pause", expectedVersion: missionBefore!.version });
    const after = await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } });
    run.control.pause = { requestedAt: after.pauseRequestedAt?.toISOString() ?? null, statusAfter: after.status, stepsAfterPause: 0 };
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
const dimension = { total: dataset.cases.length, dispatchCases: 0, dispatchedTools: 0, externalReadDispatches: 0, externalWriteDispatches: 0, businessWriteDispatches: 0, controlCasesWithDispatch: 0, unprovenContentChecks: 0 };
const started = Date.now();
let index = 0;
for (const testCase of dataset.cases) {
  index++;
  const caseStarted = Date.now();
  const refs = await materializeFixture(testCase.input.fixtureId);
  const input = await routingInputFor(refs, testCase.input.message, testCase.input.event);
  const decision = routeSkillRequest(input);
  const run = decision.mode === "RUN" ? await executeRun(testCase, refs, decision) : await executeControl(testCase, refs, decision);
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
      tools: run.steps.map(step => ({ name: step.tool, effectClass: step.effectClass })),
      checks: checks.map(check => ({ name: check.name, passed: check.passed, judge: check.judge, evidenceRef: check.evidenceRef, detail: check.detail })),
    },
    dimensions: {
      route: { mode: decision.mode, primary: decision.primary, sequence: decision.sequence, reasonCode: decision.reasonCode, reuseMissionId: decision.reuseMissionId, evidenceGate: decision.evidenceGate, restrictions: decision.restrictions, handoffOn: decision.handoffOn, intentHash: decision.intentHash },
      toolBoundary: { passed: boundary.every(check => check.passed), checks: boundary },
      evidence: { missionId: run.missionRealId, outputsBefore: run.outputsBefore, outputsAfter: run.outputsAfter, missionStatus: run.missionStatusAfter, enteredSkills: run.evidence.entered, handoffs: run.evidence.handoffs, checkpoint: run.evidence.checkpoint, evidencePack: run.evidence.pack },
    },
    provider: "INJECTED_V2_FIXTURE", fixtureHash: datasetFingerprint.slice(0, 16), durationMs: Date.now() - caseStarted,
  });
  process.stdout.write("[" + index + "/" + dataset.cases.length + "] " + testCase.caseId + " " + decision.mode + " " + JSON.stringify(decision.sequence) + "\n");
}
const resultsFile = path.join(outDir, "results.jsonl");
fs.writeFileSync(resultsFile, results.map(record => JSON.stringify(record)).join("\n") + "\n");
const report = {
  datasetId: dataset.datasetId, datasetFingerprint, generatedAt: new Date().toISOString(),
  provider: "INJECTED_V2_FIXTURE", modelCalls: 0, paidCalls: 0,
  cases: results.length, dimension, durationMs: Date.now() - started, resultsFile,
  note: "路由、工具边界与持久证据由真实 Router/Mission Runner/控制服务与真实 AgentMissionStep 采集；内容语义判据在离线注入模型下标记 UNPROVEN，不判真，按失败计入最终证据维度。",
};
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await db.$disconnect();
if (process.env.PM_KEEP_DB) console.log("TEMP_DB=" + databaseFile);
else try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* keep for inspection when locked */ }
