import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = path.resolve("prisma/xiaoyi-adapter-test.db");
const adapterToken = "test-token-that-is-longer-than-thirty-two-characters";
let projectId = "";

describe.sequential("S08 Xiaoyi record_memory adapter", () => {
  beforeAll(async () => {
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
    const sqlite = new Database(databasePath);
    const migrationsDirectory = path.resolve("prisma/migrations");
    for (const migration of fs.readdirSync(migrationsDirectory).sort()) {
      const migrationPath = path.join(migrationsDirectory, migration, "migration.sql");
      if (fs.existsSync(migrationPath)) sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
    }
    sqlite.close();

    process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
    process.env.LLM_MODE = "mock";
    process.env.XIAOYI_ENABLED = "true";
    process.env.XIAOYI_ADAPTER_ENABLED = "true";
    process.env.XIAOYI_ADAPTER_TOKEN = adapterToken;
    delete process.env.XIAOYI_RATE_LIMIT_PER_MINUTE;

    const { createProject } = await import("@/lib/repositories/projects");
    const project = await createProject({
      title: "小艺 S08 测试项目",
      description: "验证公网适配层只能写入固定项目。",
      goal: "完成 record_memory tracer bullet",
      scenario: "COMPETITION",
      deadline: null,
    });
    projectId = project.id;
    process.env.XIAOYI_TEST_PROJECT_ID = projectId;
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
    for (const suffix of ["", "-journal", "-shm", "-wal"]) {
      const filePath = `${databasePath}${suffix}`;
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    delete process.env.XIAOYI_ADAPTER_ENABLED;
    delete process.env.XIAOYI_ADAPTER_TOKEN;
    delete process.env.XIAOYI_ENABLED;
    delete process.env.XIAOYI_RATE_LIMIT_PER_MINUTE;
    delete process.env.XIAOYI_TEST_PROJECT_ID;
  });

  it("rejects a missing adapter token", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/memories/route");
    const response = await POST(new Request("http://localhost/xiaoyi/v1/memories", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "missing-token-001" },
      body: JSON.stringify({ content: "这次调用不应该写入任何卡片。" }),
    }));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "XIAOYI_UNAUTHENTICATED" } });
  });

  it("rejects a model-supplied project_id", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/memories/route");
    const response = await POST(new Request("http://localhost/xiaoyi/v1/memories", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adapterToken}`,
        "content-type": "application/json",
        "idempotency-key": "forged-project-001",
      },
      body: JSON.stringify({ content: "不能写入模型指定的项目。", project_id: "forged-project" }),
    }));
    expect(response.status).toBe(422);
  });

  it("writes one card and replays the same receipt for a duplicate request", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/memories/route");
    const { db } = await import("@/lib/db");
    const request = () => new Request("http://localhost/xiaoyi/v1/memories", {
      method: "POST",
      headers: {
        authorization: `Bearer ${adapterToken}`,
        "content-type": "application/json",
        "idempotency-key": "record-memory-001",
      },
      body: JSON.stringify({ content: "记录一下：香港 ECS 已经完成域名解析。" }),
    });

    const first = await POST(request());
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { card_id: string; agent_run_id: string; replayed: boolean };
    expect(firstBody).toMatchObject({ replayed: false });
    expect(firstBody).not.toHaveProperty("project_id");

    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    const duplicateBody = await duplicate.json() as typeof firstBody;
    expect(duplicateBody).toMatchObject({
      card_id: firstBody.card_id,
      agent_run_id: firstBody.agent_run_id,
      replayed: true,
    });

    expect(await db.knowledgeCard.count({ where: { projectId } })).toBe(1);
    expect(await db.knowledgeCard.count({ where: { id: firstBody.card_id, projectId } })).toBe(1);
    const receipts = await db.agentRun.findMany({
      where: { provider: "xiaoyi-workflow", externalRequestId: "record-memory-001" },
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: "SUCCESS", resultJson: { card_id: firstBody.card_id } });
  });

  it("queries the shared memory API and replays its receipt", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/memories/search/route");
    const request = () => new Request("http://localhost/xiaoyi/v1/memories/search", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "域名解析", request_id: "query-memory-001", top_k: 5 }),
    });

    const first = await POST(request());
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { results: Array<{ card_id: string }>; retrieval_mode: string; replayed: boolean; agent_run_id: string };
    expect(firstBody).toMatchObject({ retrieval_mode: "keyword_fallback", replayed: false });
    expect(firstBody.results[0]?.card_id).toBeTruthy();

    const duplicate = await POST(request());
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({
      agent_run_id: firstBody.agent_run_id,
      replayed: true,
    });
  });

  it("inspects project state through the same project authorization boundary", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/projects/inspect/route");
    const response = await POST(new Request("http://localhost/xiaoyi/v1/projects/inspect", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: "inspect-project-001", refresh: true }),
    }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      project: { id: projectId, title: "小艺 S08 测试项目" },
      state: { open_intervention_count: expect.any(Number), open_action_count: expect.any(Number) },
      replayed: false,
    });
  });

  it("prepares an action without writing it, then commits exactly once after confirmation", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/actions/route");
    const { db } = await import("@/lib/db");
    const prepare = await POST(new Request("http://localhost/xiaoyi/v1/actions", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: "create-action-proposal-001", title: "补齐小艺接入验收记录", priority: 3 }),
    }));
    expect(prepare.status).toBe(200);
    const proposal = await prepare.json() as { proposal_id: string; confirmed: boolean };
    expect(proposal.confirmed).toBe(false);
    expect(proposal.proposal_id.length).toBeGreaterThan(20);
    expect(await db.actionItem.count({ where: { projectId } })).toBe(0);

    const commit = await POST(new Request("http://localhost/xiaoyi/v1/actions", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: "create-action-commit-001", confirmed: true, proposal_id: proposal.proposal_id }),
    }));
    expect(commit.status).toBe(201);
    const committed = await commit.json() as { action: { id: string }; replayed: boolean };
    expect(committed.replayed).toBe(false);
    expect(committed.action.id).toBeTruthy();
    expect(await db.actionItem.count({ where: { projectId } })).toBe(1);

    const duplicate = await POST(new Request("http://localhost/xiaoyi/v1/actions", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: "create-action-commit-001", confirmed: true, proposal_id: proposal.proposal_id }),
    }));
    expect(duplicate.status).toBe(200);
    await expect(duplicate.json()).resolves.toMatchObject({ action: { id: committed.action.id }, replayed: true });
    expect(await db.actionItem.count({ where: { projectId } })).toBe(1);
  });

  it("rejects an invalid proposal before creating an action", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/actions/route");
    const { db } = await import("@/lib/db");
    const response = await POST(new Request("http://localhost/xiaoyi/v1/actions", {
      method: "POST",
      headers: { authorization: `Bearer ${adapterToken}`, "content-type": "application/json" },
      body: JSON.stringify({ request_id: "create-action-invalid-001", confirmed: true, proposal_id: "invalid-proposal-token-xxxxxxxx" }),
    }));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "XIAOYI_PROPOSAL_INVALID" } });
    expect(await db.actionItem.count({ where: { projectId } })).toBe(1);
  });

  it("enforces the configured per-token rate limit", async () => {
    const { POST } = await import("@/app/xiaoyi/v1/memories/search/route");
    process.env.XIAOYI_ADAPTER_TOKEN = "second-test-token-that-is-also-longer-than-thirty-two-characters";
    process.env.XIAOYI_RATE_LIMIT_PER_MINUTE = "1";
    const request = (requestId: string) => new Request("http://localhost/xiaoyi/v1/memories/search", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.XIAOYI_ADAPTER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ query: "域名解析", request_id: requestId }),
    });
    expect((await POST(request("rate-limit-001"))).status).toBe(200);
    const limited = await POST(request("rate-limit-002"));
    expect(limited.status).toBe(429);
    await expect(limited.json()).resolves.toMatchObject({ error: { code: "XIAOYI_RATE_LIMITED" } });
    process.env.XIAOYI_ADAPTER_TOKEN = adapterToken;
    delete process.env.XIAOYI_RATE_LIMIT_PER_MINUTE;
  });
});
