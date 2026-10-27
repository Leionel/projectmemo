import { E2E_DATABASE_URL } from "./e2e-env";
if (process.env.DATABASE_URL !== E2E_DATABASE_URL) throw new Error("Review fixture requires the exact isolated E2E database");
const [operation, id] = process.argv.slice(2), { db } = await import("../lib/db");
try {
  if (operation === "remove") {
    const p = await db.project.findFirstOrThrow({ where: { id, description: "R4_REVIEW_FIXTURE_ONLY" } });
    for (const c of await db.conversation.findMany({ where: { homeProjectId: p.id } })) {
      await db.agentRun.deleteMany({ where: { conversationId: c.id } }); await db.conversation.delete({ where: { id: c.id } });
    }
    await db.project.delete({ where: { id: p.id } });
  } else if (operation === "create") {
    Object.assign(process.env, { FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", GOAL_CHANGE_REVIEW_ENABLED: "true", MISSION_ENABLED: "true", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "isolated-fixture-only" });
    const project = await db.project.create({ data: { title: "R4 同条件课程对照", description: "R4_REVIEW_FIXTURE_ONLY", goal: "在同一 S2 划分上比较算法 A 和 B 的原始输出", scenario: "COURSE_DESIGN", memberships: { create: { userId: id } } } });
    const capture = await db.capture.create({ data: { projectId: project.id, rawText: "算法 A 使用 S1，算法 B 使用 S2，目前无法直接比较。", sourceType: "UI_FIXTURE_NO_MODEL" } });
    const { createMission } = await import("../lib/mission/missionService"), { createSession } = await import("../lib/auth/session");
    const m = await createMission(id, { requestId: "review-mission", projectId: project.id, goal: project.goal, llmContextApproved: true });
    const actor = { userId: id, sessionId: (await createSession(id)).session.id }, { createConversation, bindRefs } = await import("../lib/conversation/service");
    const c = await createConversation(actor, { requestId: "review-conversation", scope: "PROJECT", projectId: project.id, title: "R4 变化与取舍" }), ref = { kind: "MISSION" as const, id: m.id, projectId: project.id };
    await db.$transaction(tx => bindRefs(tx, c.id, [{ ...ref, title: m.goal, href: "/" }]));
    const { submitConversationReview } = await import("../lib/conversation/reviewService"), { sourceHash } = await import("../lib/mission/repository");
    const pointer = { id: "capture:" + capture.id, hash: (await sourceHash(project.id, "capture:" + capture.id))! }, original = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)), data = JSON.parse(body.messages[1].content).data, d1 = body.messages[0].content.startsWith("任务 decision.d1");
      const result = d1 ? { decision: "ATTEND", summary: "划分条件不同，先核对原记录再决定是否重跑。", candidates: [{ premise: "原比较条件不一致", goalQuote: project.goal, question: "是否已有同一 S2 划分的原始输出？", changeKind: "CONFLICT", relevance: "DIRECT", goalLink: "PROJECT_OBSERVATION", reason: "当前两个算法使用不同划分，不能按同条件比较。", evidence: [{ ref: data.evidence[0].ref, quote: "算法 A 使用 S1，算法 B 使用 S2" }], unknown: ["同一划分的输出是否已存在"] }] }
        : { summary: "先读已有输出；没有新资料时也可保留当前计划。", candidates: [{ kind: "READ_EXISTING", title: "核对已有输出", reason: "优先使用原记录，不直接要求重跑。", question: null, sourceIds: [pointer.id], expectedObservation: "是否存在同一 S2 条件的输出", stopCondition: "读取后等待核对，不自动改实验", branches: [{ observation: "同条件输出已存在", consequence: "继续做对照" }, { observation: "缺少同条件输出", consequence: "先补齐缺失条件" }], evidence: [] }, { kind: "KEEP_PLAN", title: "保留当前计划", reason: "暂不新增工作，保留当前未知。", question: null, sourceIds: [], expectedObservation: "", stopCondition: "有新观察时再复核", branches: [], evidence: [] }] };
      return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }], usage: { prompt_tokens: 40, completion_tokens: 40 } }));
    };
    try {
      const root = await submitConversationReview(actor, c.id, { requestId: "d1", expectedConversationVersion: 1, ref, purpose: "CHANGE_REVIEW", expectedVersion: m.version, llmContextApproved: true, sources: [pointer] });
      await submitConversationReview(actor, c.id, { requestId: "d2", expectedConversationVersion: root.conversation.version, ref, purpose: "DYNAMIC_PLAN", expectedVersion: m.version, llmContextApproved: true, reviewId: root.review!.id });
    } finally { globalThis.fetch = original; }
    console.log(JSON.stringify({ projectId: project.id, conversationId: c.id, missionId: m.id, paidCalls: 0 }));
  } else throw new Error("Expected create/remove");
} finally { await db.$disconnect(); }
