import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Database from "better-sqlite3";
const [mode, dir] = process.argv.slice(2), root = path.resolve(dir);
if (!root.startsWith(path.join(os.tmpdir(), "pm-ct1-probe-"))) throw new Error("ISOLATED_PROBE_ONLY");
Object.assign(process.env, { DATABASE_URL: "file:" + path.join(root, "test.sqlite").replaceAll("\\", "/"),
  FOCUS_AGENT_ENABLED: "true", FOCUS_AGENT_R4_ENABLED: "true", FOCUS_CONTINUITY_ENABLED: "true", FOCUS_ASYNC_ENABLED: "true",
  FOCUS_WEB_ENABLED: "false", LLM_MODE: "openai-compatible", LLM_PROVIDER: "deepseek", LLM_API_KEY: "synthetic-local-stub", SEMANTIC_MEMORY_ENABLED: "false" });
if (mode === "setup") {
  const sql = new Database(path.join(root, "test.sqlite")); sql.pragma("journal_mode = WAL");
  for (const name of fs.readdirSync("prisma/migrations").sort()) { const file = path.join("prisma/migrations", name, "migration.sql"); if (fs.existsSync(file)) sql.exec(fs.readFileSync(file, "utf8")); } sql.close();
}
const { db } = await import("../lib/db"), { createSession } = await import("../lib/auth/session"),
  { createConversation } = await import("../lib/conversation/service"), { submitConversationTurn } = await import("../lib/conversation/turnService"),
  { runConversationTurn } = await import("../lib/conversation/turnWorker");
try {
  if (mode === "setup") {
    const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "并发合成用户", passwordHash: "unused" } });
    const actor = { userId: user.id, sessionId: (await createSession(user.id)).session.id };
    const p = await db.project.create({ data: { title: "演示调查", goal: "目标设备完成演示", description: "synthetic", scenario: "COMPETITION", memberships: { create: { userId: user.id } } } });
    const captures = [];
    for (const rawText of ["旧版规则不适用于本届；继续核对本届记录。", "本届要求目标设备启动日志；当前只有安装自报，缺启动日志。"] ) {
      const capture = await db.capture.create({ data: { projectId: p.id, rawText } }); captures.push(capture.id);
      await db.knowledgeCard.create({ data: { projectId: p.id, captureId: capture.id, type: "meeting_note", title: "资料索引", summary: "需读取原始资料", importance: 1, keywords: [], relatedTasks: [], nextActions: [] } });
    }
    const c = await createConversation(actor, { requestId: "create", scope: "PROJECT", projectId: p.id });
    const turn = await submitConversationTurn(actor, c.id, { requestId: "ask", expectedVersion: 1, projectId: p.id, message: "调查资料后判断下一步", llmContextApproved: true }, undefined, { defer: true });
    fs.writeFileSync(path.join(root, "fixture.json"), JSON.stringify({ actor, projectId: p.id, conversationId: c.id, turnId: turn.turnId, captures, goal: p.goal }));
  } else {
    const f = JSON.parse(fs.readFileSync(path.join(root, "fixture.json"), "utf8"));
    if (mode === "revise" || mode === "revise-a" || mode === "revise-b") {
      const { submitDirective } = await import("../lib/continuity/directiveService");
      try {
        await submitDirective(f.actor, f.conversationId, { commandId: mode, expectedSeq: 0, scope: { projectId: f.projectId }, operation: "SET", quote: mode === "revise-b" ? "今天先核对启动日志" : "本周先稳演示，先别加功能" });
        fs.writeFileSync(path.join(root, mode + "-result.json"), JSON.stringify({ status: "APPLIED" }));
      } catch (e) {
        if (mode === "revise") throw e;
        fs.writeFileSync(path.join(root, mode + "-result.json"), JSON.stringify({ status: "REJECTED", code: (e as { code?: string }).code }));
      }
      fs.writeFileSync(path.join(root, "release"), "revised");
    } else {
      let calls = 0;
      globalThis.fetch = async (_target, init) => {
        calls++;
        if (mode === "takeover") throw new Error("TAKEOVER_MUST_NOT_REDISPATCH");
        const body = JSON.parse(String(init?.body)), stage = body.messages[0].content.match(/^任务 (\S+)/)?.[1];
        const data = JSON.parse(body.messages[1].content).data;
        if (calls === 1) {
          fs.writeFileSync(path.join(root, "route-dispatched"), "1");
          const deadline = Date.now() + 25000;
          while (!fs.existsSync(path.join(root, "release"))) { if (Date.now() > deadline) throw new Error("PROBE_BARRIER_TIMEOUT"); await new Promise(r => setTimeout(r, 25)); }
        }
        let answer: unknown;
        if (stage === "focus.route.v2") answer = { intent: "ANSWER", projectIds: [f.projectId], query: "资料", investigate: true, informationNeeds: ["核对演示依据"] };
        else if (stage === "focus.internal_investigate.v1" || stage === "focus.investigate.v1") {
          const originals = data.sources.filter((s: { sourceId: string }) => s.sourceId.startsWith("capture:"));
          const next = f.captures.find((id: string) => !originals.some((s: { sourceId: string }) => s.sourceId === "capture:" + id));
          const pointer = data.materialPointers.find((p: { sourceId: string }) => p.sourceId === "capture:" + next);
          answer = { goalAssessments: [{ projectId: f.projectId, goalQuote: f.goal, criteria: [{ requirement: "目标设备启动", state: "UNKNOWN", explanation: "需要原记录和启动日志", observations: [] }], blockers: [], keyUnknowns: ["核对演示依据"], nextInformationNeed: "核对演示依据" }],
            decision: next ? { decision: "READ_EXISTING", informationNeed: "核对演示依据", expectedObservation: "核对规则适用范围与实际启动记录", call: { tool: "read_project_material", projectId: f.projectId, sourceId: pointer.sourceId, revision: pointer.revision } } : { decision: "ANSWER_NOW", reason: "新记录表明缺少启动日志" } };
        } else if (stage === "focus.answer.v2") answer = { advice: "当前先补目标设备启动日志，安装自报尚未证明演示成功。", recommendedProjectId: f.projectId, observations: [], priorities: [], action: null };
        else if (stage === "focus.ui_plan.v1") answer = { schemaVersion: 2, intent: "EXPLAIN", primaryIntent: "EXPLAIN", composition: [{ blockKey: "current", semanticType: "prose", emphasis: "primary", dataRefs: [], text: "先补启动日志，再判断演示是否完成。" }] };
        else throw new Error("Unexpected stage " + stage);
        return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }));
      };
      if (mode === "takeover") await db.conversationTurn.update({ where: { id: f.turnId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
      await runConversationTurn();
      fs.writeFileSync(path.join(root, mode + "-result.json"), JSON.stringify({ calls, turn: await db.conversationTurn.findUniqueOrThrow({ where: { id: f.turnId } }),
        assistantCount: await db.agentMessage.count({ where: { conversationId: f.conversationId, role: "ASSISTANT" } }) }));
      if (mode === "takeover") fs.writeFileSync(path.join(root, "release"), "takeover-finished");
    }
  }
} finally { await db.$disconnect(); }
