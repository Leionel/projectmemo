import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = path.resolve("prisma/projectmemo-trust-receipt-test.db");

describe.sequential("W05 trust receipt integration", () => {
  beforeAll(() => {
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
    const sqlite = new Database(databasePath);
    for (const migration of fs.readdirSync(path.resolve("prisma/migrations")).sort()) {
      const migrationPath = path.join("prisma/migrations", migration, "migration.sql");
      if (fs.existsSync(migrationPath)) sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
    }
    sqlite.close();
    process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
    process.env.LLM_MODE = "mock";
    process.env.TEMPORAL_MEMORY_ENABLED = "true";
    process.env.EVIDENCE_TRUST_RECEIPT_ENABLED = "true";
    process.env.SEMANTIC_MEMORY_ENABLED = "false";
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
  });

  it("abstains without evidence and blocks a forged write", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { answerProjectQuestion, executeCopilotTool } = await import("@/lib/services/copilotService");
    const project = await createProject({
      title: "空证据回执项目",
      description: "用于验证没有项目记忆时必须明确拒答并阻止写操作。",
      goal: "验证拒答闸门",
      scenario: "COMPETITION",
      deadline: null,
    });
    const answer = await answerProjectQuestion(project.id, "消融实验已经完成了吗？");
    expect(answer.trustReceipt).toMatchObject({ supportState: "INSUFFICIENT", abstained: true });
    expect(answer.proposedActions).toEqual([]);
    const reminderStatus = await answerProjectQuestion(project.id, "为什么当前项目会触发提醒？依据是什么？");
    expect(reminderStatus.message).toContain("没有开放中的真实主动提醒");
    expect(reminderStatus.trustReceipt).toMatchObject({
      supportState: "SUPPORTED",
      abstained: false,
      retrievalMode: "project_state",
      claims: [{ projectRefs: [{ kind: "project_status", entityId: project.id }] }],
    });
    expect(reminderStatus.proposedActions).toEqual([]);
    await expect(executeCopilotTool(project.id, {
      tool: "create_action",
      confirmed: true,
      sourceRunId: reminderStatus.runId,
      payload: { title: "从状态回答伪造行动" },
    })).rejects.toMatchObject({ code: "UNAPPROVED_TOOL_PROPOSAL" });
    await expect(executeCopilotTool(project.id, {
      tool: "create_action",
      confirmed: true,
      sourceRunId: answer.runId,
      payload: { title: "伪造的行动建议" },
    })).rejects.toMatchObject({ code: "EVIDENCE_NOT_SUPPORTED" });
  });

  it("persists a supported receipt and executes only its confirmed proposal", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { answerProjectQuestion, executeCopilotTool, getProjectChat } = await import("@/lib/services/copilotService");
    const project = await createProject({
      title: "充分证据回执项目",
      description: "用于验证当前卡片可以支撑回答和来源受限的写操作。",
      goal: "验证可信执行闭环",
      scenario: "RESEARCH",
      deadline: null,
    });
    await processCapture(project.id, "消融实验已完成，结果显示移除时间化账本后拒答召回率下降。", "实验记录");
    const naturalQuestion = await answerProjectQuestion(project.id, "消融实验完成了吗？");
    expect(naturalQuestion.trustReceipt).toMatchObject({ supportState: "SUPPORTED", abstained: false });
    expect(naturalQuestion.citations.length).toBeGreaterThan(0);
    const answer = await answerProjectQuestion(project.id, "消融实验 下一步 做什么？");
    expect(answer.trustReceipt).toMatchObject({ supportState: "SUPPORTED", abstained: false });
    expect(answer.proposedActions[0]?.kind).toBe("create_action");

    const proposal = answer.proposedActions[0];
    const execution = await executeCopilotTool(project.id, {
      tool: "create_action",
      confirmed: true,
      sourceRunId: answer.runId,
      payload: { title: proposal.title, description: proposal.description, priority: proposal.priority },
    });
    expect(execution.tool).toBe("create_action");
    await expect(executeCopilotTool(project.id, {
      tool: "create_action",
      confirmed: true,
      sourceRunId: answer.runId,
      payload: { title: "不属于回执的替换行动" },
    })).rejects.toMatchObject({ code: "UNAPPROVED_TOOL_PROPOSAL" });

    const history = await getProjectChat(project.id);
    expect(history.at(-1)?.trustReceipt).toMatchObject({ supportState: "SUPPORTED" });
  });

  it("answers from current reminder records without treating a demo reminder as real", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { db } = await import("@/lib/db");
    const { answerProjectQuestion, getProjectChat } = await import("@/lib/services/copilotService");
    const project = await createProject({
      title: "提醒状态测试项目", description: "验证当前提醒的结构化依据", goal: "核对提醒",
      scenario: "COMPETITION", deadline: null,
    });
    await db.agentIntervention.create({ data: {
      projectId: project.id, triggerType: "RISK_UNHANDLED", dedupeKey: "real-risk",
      status: "OPEN", severity: 4, title: "实验材料缺口", content: "缺少可核对的实验材料。",
      evidence: { facts: [] }, proposedActions: [], isSimulated: false,
    } });
    await db.agentIntervention.create({ data: {
      projectId: project.id, triggerType: "RISK_UNHANDLED", dedupeKey: "demo-risk",
      status: "OPEN", severity: 5, title: "演示提醒", content: "仅用于演示。",
      evidence: { facts: [] }, proposedActions: [], isSimulated: true,
    } });
    const answer = await answerProjectQuestion(project.id, "当前有哪些提醒？依据是什么？");
    expect(answer.message).toContain("1 条开放中的真实主动提醒");
    expect(answer.message).toContain("实验材料缺口");
    expect(answer.message).not.toContain("演示提醒");
    expect(answer.trustReceipt?.claims[0].projectRefs).toHaveLength(2);
    const history = await getProjectChat(project.id);
    expect(history.at(-1)?.trustReceipt?.claims[0].projectRefs).toHaveLength(2);
  });
});
