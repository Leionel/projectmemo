import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "@/lib/db";
import { executeCopilotTool } from "@/lib/services/copilotService";
import { AgentRunType, AgentRunStatus } from "@/lib/generated/prisma/client";

describe("Copilot Tool Execution Concurrency & Idempotency", () => {
  let projectId: string;

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "Copilot并发幂等测试项目",
        description: "验证工具执行锁与并发幂等",
        goal: "并发幂等",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
  });

  it("ensures exactly 1 action is created when the same proposal is confirmed concurrently", async () => {
    const proposal = {
      kind: "create_action",
      title: "并发测试提案-唯一行动",
      description: "由测试用例触发",
      priority: 2,
    };

    const run = await db.agentRun.create({
      data: {
        projectId,
        runType: AgentRunType.CHAT,
        status: AgentRunStatus.SUCCESS,
        provider: "vitest",
        trace: {
          supportState: "SUPPORTED",
        },
        resultJson: {
          proposedActions: [proposal],
        },
      },
    });

    const input = {
      tool: "create_action" as const,
      confirmed: true,
      sourceRunId: run.id,
      payload: {
        title: proposal.title,
        priority: 5, // 客户端篡改应被服务端的 proposal.priority (2) 覆盖
      },
    };

    // 并发执行两次
    const outcomes = await Promise.all([
      executeCopilotTool(projectId, input),
      executeCopilotTool(projectId, input),
    ]);

    expect(outcomes.length).toBe(2);
    // 其中一个返回正常创建，另一个返回 alreadyExecuted: true
    const hasAlreadyExecuted = outcomes.some(
      (o) => (o as { alreadyExecuted?: boolean }).alreadyExecuted === true
    );
    expect(hasAlreadyExecuted).toBe(true);

    // 数据库中该标题的待办严格只有 1 条
    const actions = await db.actionItem.findMany({
      where: {
        projectId,
        title: proposal.title,
      },
    });
    expect(actions.length).toBe(1);
    expect(actions[0].priority).toBe(2); // 服务端存证优先级保护生效
  });

  it("supports concurrent execution of different proposals on the same run without overwriting executedProposals", async () => {
    const proposalA = {
      kind: "create_action",
      title: "并发多提案A",
      description: "提案A描述",
      priority: 1,
    };
    const proposalB = {
      kind: "create_action",
      title: "并发多提案B",
      description: "提案B描述",
      priority: 3,
    };

    const run = await db.agentRun.create({
      data: {
        projectId,
        runType: AgentRunType.CHAT,
        status: AgentRunStatus.SUCCESS,
        provider: "vitest",
        trace: {
          supportState: "SUPPORTED",
        },
        resultJson: {
          proposedActions: [proposalA, proposalB],
        },
      },
    });

    const inputA = {
      tool: "create_action" as const,
      confirmed: true,
      sourceRunId: run.id,
      payload: { title: proposalA.title },
    };
    const inputB = {
      tool: "create_action" as const,
      confirmed: true,
      sourceRunId: run.id,
      payload: { title: proposalB.title },
    };

    // 并发确认两个不同提案
    const [resA, resB] = await Promise.all([
      executeCopilotTool(projectId, inputA),
      executeCopilotTool(projectId, inputB),
    ]);

    expect(resA.tool).toBe("create_action");
    expect(resB.tool).toBe("create_action");

    // 两个行动各自创建成功
    const actions = await db.actionItem.findMany({
      where: {
        projectId,
        title: { in: [proposalA.title, proposalB.title] },
      },
    });
    expect(actions.length).toBe(2);

    // 检查 agentRun.resultJson.executedProposals，必须同时包含两个提案的执行记录
    const updatedRun = await db.agentRun.findUnique({
      where: { id: run.id },
    });
    const resultJson = updatedRun?.resultJson as {
      executedProposals?: Record<string, { tool: string; resultId: string }>;
    };
    expect(resultJson?.executedProposals).toBeDefined();
    expect(resultJson.executedProposals![`action:${proposalA.title}`]).toBeDefined();
    expect(resultJson.executedProposals![`action:${proposalB.title}`]).toBeDefined();
  });
});
