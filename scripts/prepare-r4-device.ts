import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
const manifestFile = process.argv[2];
if (!manifestFile || !path.resolve(manifestFile).startsWith(path.resolve("output/r4-pr3-pr4") + path.sep)) throw new Error("Use this campaign's isolated model manifest");
const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")), source = String(manifest.databaseUrl).slice(5);
const refreshing = process.argv.includes("--refresh-approval");
if (refreshing ? !fs.realpathSync(source).startsWith(path.join(fs.realpathSync(os.tmpdir()), "pm-r4-acceptance-")) :
  manifest.provenance !== "REAL_MODEL_SYNTHETIC_DEVELOPMENT" || !fs.realpathSync(source).startsWith(path.join(fs.realpathSync(os.tmpdir()), "pm-r4-closure-"))) throw new Error("Not an isolated synthetic evaluation database");
const destination = refreshing ? source : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pm-r4-acceptance-")), "device.sqlite");
if (!refreshing) { const input = new Database(source); try { await input.backup(destination); } finally { input.close(); } }
process.env.DATABASE_URL = "file:" + destination.replaceAll("\\", "/");
Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_AGENT_FOLLOW_ENABLED: "true", MISSION_ENABLED: "true", MISSION_EVENT_CONTINUATION_ENABLED: "true", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "isolated-device-fixture-only", SEMANTIC_MEMORY_ENABLED: "false" });
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session");
const { createConversation } = await import("../lib/conversation/service"), { submitConversationTurn } = await import("../lib/conversation/turnService");
const user = await db.user.findUniqueOrThrow({ where: { username: "r4-local-review" } }), actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
try {
  if (refreshing) {
    const { readConversation } = await import("../lib/conversation/service"), { r4FixtureResponse } = await import("./r4-fixture-provider");
    const view = await readConversation(actor, manifest.approvalConversationId), original = globalThis.fetch;
    if (!await db.project.findFirst({ where: { id: view.homeProjectId!, description: "R4_DEVICE_FIXTURE_ONLY" } })) throw new Error("Not the device fixture project");
    globalThis.fetch = async (_url, init) => r4FixtureResponse(JSON.parse(init!.body as string));
    try { await submitConversationTurn(actor, view.id, { requestId: "refresh:" + crypto.randomUUID(), expectedVersion: view.version,
      projectId: view.homeProjectId, message: "请按当前资料重新生成一项待确认的核对行动。", llmContextApproved: true }); }
    finally { globalThis.fetch = original; }
    console.log(JSON.stringify({ conversationId: view.id, refreshedFixtureOnly: true, paidCalls: 0 }));
    process.exitCode = 0;
  } else {
  const project = await db.project.create({ data: { title: "UI 合成验收·同条件部署", description: "R4_DEVICE_FIXTURE_ONLY", goal: "模型 A 在设备 D 推理显存不超过 6GB", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
  const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "UI_SYNTHETIC_FIXTURE", rawText: "设备 D、模型 A v2、推理 batch=1，显存峰值 6.8GB，超过 6GB 预算。" } });
  await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: "资料索引·原始条件", summary: "资料摘要没有列出适用条件，请查看原始记录。", type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
  const conversation = await createConversation(actor, { requestId: "device-approval", scope: "PROJECT", projectId: project.id, title: "UI 验收·确认与回执" });
  const { r4FixtureResponse } = await import("./r4-fixture-provider"), original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => r4FixtureResponse(JSON.parse(init!.body as string));
  try { await submitConversationTurn(actor, conversation.id, { requestId: "device-question", expectedVersion: 1, message: "请调查目标差距，并给出待确认的下一步行动。", projectId: project.id, llmContextApproved: true }); }
  finally { globalThis.fetch = original; }
  const { createMission } = await import("../lib/mission/missionService"), { runMissionSlice } = await import("../lib/mission/runner"), { currentGoalQuestion } = await import("../lib/decision/questions");
  const mission = await createMission(user.id, { projectId: project.id, requestId: "device-mission", goal: "核对设备D部署目标的10月显存记录", llmContextApproved: false });
  await runMissionSlice({ id: mission.id, provider: async () => ({ choice: { kind: "ask", question: "请补充10月设备D推理显存数值", missing: "PRIVATE", requirements: { terms: ["显存", "10月"], period: "10月", unit: "GB", sourceType: "CAPTURE" } }, provider: "UI_FIXTURE_NO_MODEL", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 0, outputTokens: 0 } }) });
  const question = (await currentGoalQuestion(actor, project.id)).question!;
  const eventConversation = await createConversation(actor, { requestId: "device-event", scope: "WORKSPACE", title: "UI 验收·资料变化", entry: { kind: "GOAL_QUESTION", id: question.questionId, projectId: project.id } });
  const { listConversationAnchors, commandConversationAnchor, syncConversationAnchors } = await import("../lib/conversation/anchorService"), { scanWaitingMaterials } = await import("../lib/mission/sourceSignals");
  const anchor = (await listConversationAnchors(actor, eventConversation.id)).anchors[0];
  await commandConversationAnchor(actor, eventConversation.id, anchor.id, { requestId: "device-follow", expectedVersion: anchor.version, action: "FOLLOW" });
  await db.capture.create({ data: { projectId: project.id, rawText: "10月设备D模型A推理，显存峰值6.8GB；条件仍需人工核对。", sourceType: "UI_SYNTHETIC_FIXTURE" } });
  await scanWaitingMaterials(100); await syncConversationAnchors(actor, eventConversation.id);
  const output = { databaseUrl: process.env.DATABASE_URL, userId: user.id, approvalConversationId: conversation.id, eventConversationId: eventConversation.id,
    projectId: project.id, sourceModelManifest: path.resolve(manifestFile), fixtureModelCalls: 0, uiFixtureProvider: "HTTP_STUB_NOT_PAID_MODEL" };
  fs.writeFileSync("output/r4-pr3-pr4/device-manifest.json", JSON.stringify(output, null, 2) + "\n"); console.log(JSON.stringify(output));
  }
} finally { await db.$disconnect(); }
