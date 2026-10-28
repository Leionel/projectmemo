import { E2E_DATABASE_URL } from "./e2e-env";
if (process.env.DATABASE_URL !== E2E_DATABASE_URL) throw new Error("ISOLATED_CONTINUITY_E2E_ONLY");
const [operation, value] = process.argv.slice(2);
const { db } = await import("../lib/db");
try {
  if (operation === "remove") {
    const project = await db.project.findFirstOrThrow({ where: { id: value, description: "CT1_BROWSER_FIXTURE_ONLY" } });
    const conversations = await db.conversation.findMany({ where: { homeProjectId: project.id } });
    for (const c of conversations) { await db.agentRun.deleteMany({ where: { conversationId: c.id } }); await db.conversation.delete({ where: { id: c.id } }); }
    await db.agentDirectiveEvent.deleteMany({ where: { projectId: project.id } });
    await db.project.delete({ where: { id: project.id } });
  } else if (operation === "create") {
    Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", MISSION_ENABLED: "true", LLM_MODE: "mock" });
    const { createSession } = await import("../lib/auth/session"), { createConversation } = await import("../lib/conversation/service"),
      { submitConversationTurn } = await import("../lib/conversation/turnService"), { createMission, commandMission } = await import("../lib/mission/missionService");
    const actor = { userId: value, sessionId: (await createSession(value)).session.id };
    const p = await db.project.create({ data: { title: "连续协作验收", description: "CT1_BROWSER_FIXTURE_ONLY", goal: "目标设备完成演示", scenario: "COMPETITION", memberships: { create: { userId: value } } } });
    const c = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: p.id });
    const old = await submitConversationTurn(actor, c.id, { requestId: "old", expectedVersion: 1, projectId: p.id, message: "创建下一步行动，继续扩功能" });
    const m = await createMission(value, { requestId: "mission", projectId: p.id, goal: "整理演示记录", llmContextApproved: true });
    await commandMission(value, m.id, "pause", { requestId: "pause", expectedVersion: m.version });
    console.log(JSON.stringify({ projectId: p.id, conversationId: c.id, missionId: m.id, old: old.conversation.messages.at(-1)!.proposal }));
  } else throw new Error("Expected create/remove");
} finally { await db.$disconnect(); }
