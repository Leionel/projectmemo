import { E2E_DATABASE_URL } from "./e2e-env";
if (process.env.DATABASE_URL !== E2E_DATABASE_URL) throw new Error("R4 browser fixture requires the exact isolated E2E database");
const [operation, value] = process.argv.slice(2);
const { db } = await import("../lib/db");
try {
  if (operation === "remove") {
    const p = await db.project.findFirst({ where: { id: value, description: "R4_BROWSER_FIXTURE_ONLY" } });
    if (!p) throw new Error("Not an R4 fixture project");
    const rows = await db.conversation.findMany({ where: { homeProjectId: p.id }, select: { id: true } });
    for (const row of rows) {
      await db.agentRun.deleteMany({ where: { conversationId: row.id } });
      await db.conversation.delete({ where: { id: row.id } });
    }
    await db.project.delete({ where: { id: p.id } });
  } else if (operation === "create") {
    Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", MISSION_ENABLED: "true", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "isolated-fixture-only" });
    const user = await db.user.findUniqueOrThrow({ where: { id: value } });
    const project = await db.project.create({ data: { title: "R4 同条件部署验收", description: "R4_BROWSER_FIXTURE_ONLY", goal: "模型 A 在设备 D 推理显存不超过 6GB", scenario: "RESEARCH", memberships: { create: { userId: user.id } } } });
    const capture = await db.capture.create({ data: { projectId: project.id, sourceType: "fixture", rawText: "设备 D、模型 A v2、推理 batch=1，显存峰值 6.8GB，超过 6GB 预算。" } });
    await db.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, title: "资料索引", summary: "资料摘要没有列出适用条件，请查看原记录。", type: "experiment_log", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
    const { createMission } = await import("../lib/mission/missionService"), { runMissionSlice } = await import("../lib/mission/runner");
    const mission = await createMission(user.id, { projectId: project.id, requestId: "fixture-mission", goal: "补充同条件部署的原始信息", llmContextApproved: false });
    await runMissionSlice({ id: mission.id, provider: async () => ({ choice: { kind: "ask", question: "请补充真实设备型号与测试条件", missing: "PRIVATE" }, provider: "FIXTURE_NO_MODEL", model: "scripted", usage: { inputTokens: 0, outputTokens: 0 }, protocol: "JSON_CHOICE" }) });
    const { createSession } = await import("../lib/auth/session"), session = await createSession(user.id), actor = { userId: user.id, sessionId: session.session.id };
    const { createConversation } = await import("../lib/conversation/service"), c = await createConversation(actor, { requestId: "fixture-conversation", title: "R4 交互验收", scope: "PROJECT", projectId: project.id });
    const { r4FixtureResponse } = await import("./r4-fixture-provider"), { submitConversationTurn } = await import("../lib/conversation/turnService");
    const fetcher = globalThis.fetch;
    globalThis.fetch = async (_url, init) => r4FixtureResponse(JSON.parse(init!.body as string));
    try { await submitConversationTurn(actor, c.id, { requestId: "fixture-turn", expectedVersion: 1, message: "请调查目标差距，帮我先处理这件事。", projectId: project.id, llmContextApproved: true }); }
    finally { globalThis.fetch = fetcher; }
    console.log(JSON.stringify({ projectId: project.id, conversationId: c.id }));
  } else throw new Error("Expected create/remove");
} finally { await db.$disconnect(); }
