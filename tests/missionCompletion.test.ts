import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-completion-"));
  const file = path.join(directory, "completion.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", MISSION_ARTIFACT_ADOPTION_ENABLED: "true", MISSION_SEMANTIC_CHECK_ENABLED: "false" });
  const sql = new Database(file);
  for (const directory of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", directory, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { directory };
});

import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission, missionDetail } from "@/lib/mission/missionService";
import { runMissionSlice } from "@/lib/mission/runner";
import { previewArtifactAdoption, confirmArtifactAdoption } from "@/lib/mission/artifactAdoptionService";
import { missionCompletionFacts, missionErrorPhaseLabel } from "@/lib/mission/presentation";
import type { Choice } from "@/lib/mission/contracts";

let userId: string, projectId: string;
beforeAll(async () => {
  userId = (await db.user.create({ data: { username: `completion-${crypto.randomUUID()}`, displayName: "完成语义隔离测试", passwordHash: "unused" } })).id;
  projectId = (await db.project.create({ data: { title: "完成语义", description: "fixture", goal: "形成草稿", scenario: "RESEARCH" } })).id;
  await db.projectMembership.create({ data: { userId, projectId, role: "OWNER" } });
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.directory, { recursive: true, force: true }); });

async function slice(id: string, choice: Choice) {
  await runMissionSlice({ id, provider: async () => ({ choice, provider: "TEST_FIXTURE", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
}
describe("Mission 完成语义只读摘要", () => {
  it("没有验收事件不推断通过，旧终态也不伪造草稿核验和采纳", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "隔离测试旧任务" });
    const before = await missionDetail(userId, m.id);
    expect(before.completion).toMatchObject({ criteriaPassed: null, draftVerification: null, adoptionCount: 0, realityOutcome: "NOT_INFERRED" });
    await db.agentMission.update({ where: { id: m.id }, data: { status: "SUCCEEDED" } });
    const legacy = await missionDetail(userId, m.id);
    expect(legacy.completion.criteriaPassed).toBeNull();
    expect(missionCompletionFacts(legacy.status, legacy.completion)[0].value).toBe("已验收，明细待读取");
    expect(await db.agentMissionEvent.count({ where: { missionId: m.id, type: "CRITERIA_CHECKED" } })).toBe(0);
  });
  it("形式条件通过、草稿待审、用户归入、现实未推断各自来自原持久记录", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "形成待审阅草稿" });
    await slice(m.id, { kind: "tool", tool: "save_mission_output", args: { blocks: [{ blockId: "note", kind: "INFERENCE", text: "这是待审核的隔离推断，不代表实验已经完成。", sourceIds: [] }] }, summary: "保存隔离草稿" });
    let detail = await missionDetail(userId, m.id);
    expect(detail.completion.criteriaPassed).toBeNull();
    await slice(m.id, { kind: "finish", outputId: detail.outputs[0].id });
    detail = await missionDetail(userId, m.id);
    expect(detail.status).toBe("SUCCEEDED");
    expect(detail.completion).toMatchObject({ criteriaPassed: true, draftVerification: "NEEDS_REVIEW", adoptionCount: 0, realityOutcome: "NOT_INFERRED" });
    const preview = await previewArtifactAdoption(userId, m.id, detail.outputs[0].id, { expectedOutputRevision: 1 });
    const receipt = await confirmArtifactAdoption(userId, m.id, detail.outputs[0].id, { requestId: crypto.randomUUID(), expectedOutputRevision: 1, expectedContextVersion: detail.contextVersion, previewHash: preview.previewHash });
    const adopted = await missionDetail(userId, m.id);
    expect(adopted.completion).toMatchObject({ criteriaPassed: true, draftVerification: "NEEDS_REVIEW", adoptionCount: 1, latestArtifactId: receipt.artifactId, realityOutcome: "NOT_INFERRED" });
    expect(await db.actionItem.count({ where: { projectId, status: "DONE" } })).toBe(0);
    expect(missionCompletionFacts(adopted.status, adopted.completion).map(fact => fact.label)).toEqual(["执行条件", "草稿核验", "用户采纳", "现实完成"]);
  });
  it("旧响应无completion或phase也可读，不把未知采纳写成未采纳", () => {
    const facts = missionCompletionFacts("SUCCEEDED", undefined, "NEEDS_REVIEW");
    expect(facts[1].value).toBe("待审阅，尚未整体核验");
    expect(facts[2].value).toBe("采纳回执待读取");
    expect(facts[3].value).toContain("未从委托状态推断");
    expect(missionErrorPhaseLabel()).toBe("执行阶段未记录");
    expect(missionErrorPhaseLabel("TOOL")).toBe("工具执行");
    expect(missionErrorPhaseLabel("CONTEXT")).toBe("准备上下文");
  });
});
