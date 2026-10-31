import fs from "node:fs";
import path from "node:path";
import { E2E_ENV, E2E_DATABASE_PATH, E2E_USERNAME } from "./e2e-env";

// This entry point never loads .env and refuses a database outside its own E2E workflow.
if (!fs.existsSync(E2E_DATABASE_PATH) || !E2E_DATABASE_PATH.endsWith(path.join("prisma", "projectmemo-e2e.db"))) throw new Error("先初始化当前工作树的独立 E2E 数据库");
Object.assign(process.env, E2E_ENV, { SEMANTIC_MEMORY_ENABLED: "false" });
const { db } = await import("../lib/db");
const { createMission, commandMission } = await import("../lib/mission/missionService");
const { runMissionSlice } = await import("../lib/mission/runner");
try {
  const user = await db.user.findUniqueOrThrow({ where: { username: E2E_USERNAME } });
  const membership = await db.projectMembership.findFirstOrThrow({ where: { userId: user.id }, orderBy: { projectId: "asc" } });
  const projectId = membership.projectId;
  const pending = await createMission(user.id, { projectId, requestId: "ui-quality-input", goal: "核对答辩材料的引用依据" });
  if (pending.status === "READY") await runMissionSlice({ id: pending.id, provider: async () => ({ choice: { kind: "ask", missing: "CRITICAL", question: "请补充本次答辩使用的实际测试记录，以及对应的代码版本。" }, provider: "UI_ACCEPTANCE_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 0, outputTokens: 0 } }) });
  const approval = await createMission(user.id, { projectId, requestId: "ui-quality-approval", goal: "准备提交前的核对行动" });
  if (approval.status === "READY") await runMissionSlice({ id: approval.id, provider: async () => ({ choice: { kind: "tool", tool: "propose_action", args: { title: "记录一次完整的演示结果", description: "确认演示流程、版本与运行结果，并留下真实回执。", priority: 3 }, summary: "请求审阅行动提案" }, provider: "UI_ACCEPTANCE_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 0, outputTokens: 0 } }) });
  const paused = await createMission(user.id, { projectId, requestId: "ui-quality-paused", goal: "整理下一轮实验计划" });
  if (paused.status === "READY") await commandMission(user.id, paused.id, "pause", { requestId: "ui-quality-pause", expectedVersion: paused.version });
  const ready = await createMission(user.id, { projectId, requestId: "ui-quality-ready", goal: "整理课程项目的阶段汇报" });
  const proof = { synthetic: true, realModel: false, workerStarted: false, projectId, missions: [pending.id, approval.id, paused.id, ready.id] };
  fs.mkdirSync("evidence/r4-ui-quality/20261031", { recursive: true });
  fs.writeFileSync("evidence/r4-ui-quality/20261031/fixture.json", JSON.stringify(proof, null, 2) + "\n");
  console.log(JSON.stringify(proof));
} finally { await db.$disconnect(); }
