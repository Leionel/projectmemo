import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { POST as postCapture } from "@/app/api/projects/[id]/captures/route";
import { getLatestProjectState, getProjectStateFreshness } from "@/lib/services/projectStateService";
import { createTestAuth } from "./testAuthHelper";

process.env.LLM_MODE = "mock";

describe.sequential("ProjectMemo phase 1 capture reliability", () => {
  let projectId = "";
  let otherProjectId = "";
  let authHeaders: Record<string, string> = {};

  beforeAll(async () => {
    const project = await db.project.create({
      data: {
        title: "第一阶段记录可靠性测试",
        description: "独立测试库中的幂等记录测试项目。",
        goal: "验证同一请求只保存一次",
        scenario: "COMPETITION",
      },
    });
    projectId = project.id;
    const otherProject = await db.project.create({
      data: {
        title: "第一阶段记录可靠性测试-跨项目",
        description: "验证同一客户端 requestId 不会跨项目碰撞。",
        goal: "验证请求身份按项目隔离",
        scenario: "COMPETITION",
      },
    });
    otherProjectId = otherProject.id;

    // 创建测试认证与 Membership 授权
    const auth = await createTestAuth(projectId);
    await auth.bindProject(otherProjectId);
    authHeaders = auth.headers;
  });

  afterAll(async () => {
    if (projectId) {
      await db.project.delete({ where: { id: projectId } }).catch(() => {});
    }
    if (otherProjectId) {
      await db.project.delete({ where: { id: otherProjectId } }).catch(() => {});
    }
  });

  function request(requestId: string, rawText: string) {
    return postCapture(
      new Request(`http://localhost/api/projects/${projectId}/captures`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestId,
          ...authHeaders,
        },
        body: JSON.stringify({ rawText, sourceType: "实验记录", requestId }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
  }

  it("同一 requestId 并发十次只生成一个 Capture 和一张卡片", async () => {
    const requestId = "phase1-capture-concurrent-001";
    const responses = await Promise.all(
      Array.from({ length: 10 }, () => request(requestId, "并发记录：实验结果需要补充对照组指标。")),
    );
    const bodies = await Promise.all(responses.map((response) => response.json()));
    const cardIds = new Set(bodies.map((body) => body.card?.id));

    expect(cardIds.size).toBe(1);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(9);
    expect(await db.capture.count({ where: { projectId, requestId } })).toBe(1);
    expect(await db.knowledgeCard.count({ where: { projectId } })).toBe(1);
    const run = await db.agentRun.findFirst({
      where: { projectId, externalRequestId: `${projectId}:${requestId}` },
    });
    expect(run?.provider).toBe("capture-api");
    expect(run?.trace).toMatchObject({ provider: "capture-api", modelProvider: "mock" });
  });

  it("同一 requestId 的不同 payload 返回 409，不创建第二张卡", async () => {
    const requestId = "phase1-capture-conflict-001";
    const first = await request(requestId, "冲突基线：记录第一次提交的实验结论。\n");
    expect(first.status).toBe(201);

    const conflict = await request(requestId, "冲突修改：这不是第一次提交的原文。\n");
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(await db.capture.count({ where: { projectId, requestId } })).toBe(1);
  });

  it("同文但不同 requestId 仍可有意创建两条记录", async () => {
    const rawText = "同文新建：用户明确要求再记录一条相同实验结论。";
    const beforeCards = await db.knowledgeCard.count({ where: { projectId } });
    const [first, second] = await Promise.all([
      request("phase1-capture-distinct-001", rawText),
      request("phase1-capture-distinct-002", rawText),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await db.capture.count({ where: { projectId, rawText } })).toBe(2);
    expect(await db.knowledgeCard.count({ where: { projectId } })).toBe(beforeCards + 2);
  });

  it("响应丢失后按原 requestId 重试返回原业务结果", async () => {
    const requestId = "phase1-capture-retry-001";
    const first = await request(requestId, "响应恢复：提交成功后客户端需要按原 ID 查询结果。" );
    expect(first.status).toBe(201);
    const firstBody = await first.json();

    const retry = await request(requestId, "响应恢复：提交成功后客户端需要按原 ID 查询结果。" );
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ card: { id: firstBody.card.id } });
    expect(await db.capture.count({ where: { projectId, requestId } })).toBe(1);
  });

  it("相同 requestId 在不同项目中仍按项目分别保存", async () => {
    const requestId = "phase1-capture-cross-project-001";
    const first = await request(requestId, "项目A的普通记录。");
    expect(first.status).toBe(201);

    const second = await postCapture(
      new Request(`http://localhost/api/projects/${otherProjectId}/captures`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": requestId,
          ...authHeaders,
        },
        body: JSON.stringify({ rawText: "项目B的普通记录。", sourceType: "实验记录", requestId }),
      }),
      { params: Promise.resolve({ id: otherProjectId }) },
    );

    expect(second.status).toBe(201);
    expect(await db.capture.count({ where: { requestId } })).toBe(2);
    expect(await db.knowledgeCard.count({ where: { projectId: otherProjectId } })).toBe(1);
  });

  it("事实保存成功后触发状态快照刷新，不把派生刷新失败当成重复建卡理由", async () => {
    const previous = process.env.PROJECT_STATE_ENABLED;
    process.env.PROJECT_STATE_ENABLED = "1";
    try {
      const response = await request("phase1-capture-state-refresh-001", "保存后刷新：普通记录应进入状态快照评估。" );
      expect(response.status).toBe(201);
      const freshness = await getProjectStateFreshness(projectId);
      const latest = await getLatestProjectState(projectId);
      expect(freshness.status).toBe("FRESH");
      expect(freshness.snapshotId).toBe(latest?.id);
      expect(latest?.projectId).toBe(projectId);
    } finally {
      if (previous === undefined) delete process.env.PROJECT_STATE_ENABLED;
      else process.env.PROJECT_STATE_ENABLED = previous;
    }
  });
});
