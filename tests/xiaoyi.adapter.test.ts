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
    process.env.XIAOYI_ADAPTER_ENABLED = "true";
    process.env.XIAOYI_ADAPTER_TOKEN = adapterToken;

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
});
