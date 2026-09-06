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
});
