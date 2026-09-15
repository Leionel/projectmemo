import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databasePath = path.resolve("prisma/projectmemo-test.db");

describe.sequential("SQLite integration", () => {
  beforeAll(() => {
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
  });

  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db.$disconnect();
    if (fs.existsSync(databasePath)) fs.unlinkSync(databasePath);
  });

  it("creates project, card, relation and artifact through services", async () => {
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { generateArtifact } = await import("@/lib/services/artifactService");
    const project = await createProject({ title: "集成测试项目", description: "验证数据库完整业务闭环。", goal: "完成自动化测试", scenario: "COMPETITION", deadline: null });
    await processCapture(project.id, "RAG 检索效果不稳定，需要优化知识库切片。", "实验记录");
    await processCapture(project.id, "需要做 RAG 检索的对照实验并提交文档。", "任务安排");
    const artifact = await generateArtifact(project.id, "weekly_report");
    const detail = await getProjectDetail(project.id);
    expect(detail.cards).toHaveLength(2);
    expect(detail.cards.some((card) => card.outgoingLinks.length > 0)).toBe(true);
    expect(artifact.content).toContain("项目周报");
  });

  it("returns a business error when artifact cards are empty", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { generateArtifact, saveEditedArtifactVersion } = await import("@/lib/services/artifactService");
    const project = await createProject({ title: "空项目", description: "这个项目用于测试空数据生成。", goal: "验证错误处理", scenario: "RESEARCH", deadline: null });
    await expect(generateArtifact(project.id, "readme")).rejects.toMatchObject({ code: "NO_KNOWLEDGE_CARDS" });
    await expect(saveEditedArtifactVersion(project.id, "readme", "绕过生成直接保存")).rejects.toMatchObject({ code: "NO_KNOWLEDGE_CARDS" });
  });

  it("stores manually edited artifact content as a new immutable version", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { generateArtifact, saveEditedArtifactVersion } = await import("@/lib/services/artifactService");
    const { listArtifacts } = await import("@/lib/repositories/artifacts");
    const { POST } = await import("@/app/api/projects/[id]/artifacts/route");
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await createProject({ title: "成果润色项目", description: "这个项目用于验证成果的人工润色与版本留存。", goal: "保存两个独立版本", scenario: "COMPETITION", deadline: null });
    const auth = await createTestAuth(project.id);
    await processCapture(project.id, "需要完成比赛 README，并清楚说明当前进展、风险和下一步。", "任务安排");
    const generated = await generateArtifact(project.id, "readme");
    const edited = await saveEditedArtifactVersion(project.id, "readme", "  # 人工润色 README\n\n这是最终演示版本。  ");
    const apiResponse = await POST(new Request(`http://localhost/api/projects/${project.id}/artifacts`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ artifactType: "readme", content: "# 接口保存版本\n\n由成果编辑器提交。" }),
    }), { params: Promise.resolve({ id: project.id }) });
    expect(apiResponse.status).toBe(201);
    await expect(apiResponse.json()).resolves.toMatchObject({ artifact: { content: "# 接口保存版本\n\n由成果编辑器提交。" } });
    const history = await listArtifacts(project.id);
    expect(edited.id).not.toBe(generated.id);
    expect(edited.content).toBe("# 人工润色 README\n\n这是最终演示版本。");
    expect(history.filter((artifact) => artifact.artifactType === "readme")).toHaveLength(3);
    expect(history.find((artifact) => artifact.id === generated.id)?.content).toBe(generated.content);
  });

  it("updates project fields, clears deadlines and rejects missing projects", async () => {
    const { createProject, deleteProject, updateProject } = await import("@/lib/repositories/projects");
    const project = await createProject({ title: "待编辑项目", description: "这个项目用于验证更新与删除操作。", goal: "完成更新测试", scenario: "COURSE_DESIGN", deadline: null });
    const updated = await updateProject(project.id, { title: "已编辑项目", goal: "验证更新成功", scenario: "INNOVATION", deadline: "2026-08-18" });
    expect(updated).toMatchObject({ title: "已编辑项目", goal: "验证更新成功", scenario: "INNOVATION" });
    expect(updated.deadline?.getFullYear()).toBe(2026);
    expect(updated.deadline?.getMonth()).toBe(7);
    expect(updated.deadline?.getDate()).toBe(18);
    expect((await updateProject(project.id, { deadline: null })).deadline).toBeNull();
    await deleteProject(project.id);
    await expect(updateProject(project.id, { title: "无法更新" })).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("exposes project update and delete through the detail API", async () => {
    const { createProject, requireProject } = await import("@/lib/repositories/projects");
    const { PATCH, DELETE } = await import("@/app/api/projects/[id]/route");
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await createProject({ title: "接口编辑项目", description: "这个项目用于验证详情接口的编辑和删除。", goal: "打通接口闭环", scenario: "COMPETITION", deadline: null });
    const auth = await createTestAuth(project.id);
    const context = { params: Promise.resolve({ id: project.id }) };
    const patchResponse = await PATCH(new Request(`http://localhost/api/projects/${project.id}`, {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({ title: "接口已更新项目", deadline: "2026-09-01" }),
    }), context);
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ project: { title: "接口已更新项目" } });
    const deleteResponse = await DELETE(new Request(`http://localhost/api/projects/${project.id}`, {
      method: "DELETE",
      headers: auth.headers,
    }), context);
    expect(deleteResponse.status).toBe(204);
    await expect(requireProject(project.id)).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });

  it("touches project activity and returns the complete artifact history", async () => {
    const { db } = await import("@/lib/db");
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { saveArtifact } = await import("@/lib/repositories/artifacts");
    const project = await createProject({ title: "历史成果项目", description: "这个项目用于验证完整成果历史和活动排序。", goal: "保留全部历史", scenario: "RESEARCH", deadline: null });
    const old = new Date("2000-01-01T00:00:00.000Z");
    await db.project.update({ where: { id: project.id }, data: { updatedAt: old } });
    await processCapture(project.id, "需要记录一次模型实验并分析 baseline 准确率变化。", "实验记录");
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).updatedAt.getTime()).toBeGreaterThan(old.getTime());

    await db.project.update({ where: { id: project.id }, data: { updatedAt: old } });
    for (let index = 0; index < 7; index += 1) {
      await saveArtifact(project.id, "weekly_report", `第 ${index + 1} 版周报`);
    }
    const detail = await getProjectDetail(project.id);
    expect(detail.artifacts).toHaveLength(7);
    expect(detail.updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("deletes project-owned captures, cards, relations and artifacts by cascade", async () => {
    const { db } = await import("@/lib/db");
    const { createProject, deleteProject } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { saveArtifact } = await import("@/lib/repositories/artifacts");
    const project = await createProject({ title: "级联删除项目", description: "这个项目用于验证所有项目资产都会被删除。", goal: "避免孤儿数据", scenario: "LAB_TASK", deadline: null });
    await processCapture(project.id, "需要提交实验报告并记录当前风险和后续任务。", "任务安排");
    await saveArtifact(project.id, "readme", "测试成果");
    await deleteProject(project.id);
    expect(await db.capture.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.knowledgeCard.count({ where: { projectId: project.id } })).toBe(0);
    expect(await db.generatedArtifact.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("corrects and removes project-owned knowledge cards with source traceability", async () => {
    const { db } = await import("@/lib/db");
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { PATCH, DELETE } = await import("@/app/api/projects/[id]/cards/[cardId]/route");
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await createProject({ title: "卡片纠错项目", description: "这个项目用于验证知识卡片的追溯、纠正与撤销。", goal: "修复错误识别", scenario: "RESEARCH", deadline: null });
    const otherProject = await createProject({ title: "另一个隔离项目", description: "这个项目用于验证卡片不能被跨项目修改。", goal: "保证数据隔离", scenario: "LAB_TASK", deadline: null });
    const auth = await createTestAuth(project.id);
    await auth.bindProject(otherProject.id);
    await processCapture(project.id, "RAG baseline 准确率需要继续记录，并补充本周对照实验。", "实验记录");
    await processCapture(project.id, "RAG baseline 对照实验需要在周五前完成并同步结果。", "任务安排");
    const before = await getProjectDetail(project.id);
    const card = before.cards[0];
    const relatedCard = before.cards[1];
    expect(card.capture.rawText).toContain("RAG baseline");
    expect(card.capture.sourceType).toBe("任务安排");

    const old = new Date("2000-01-01T00:00:00.000Z");
    await db.project.update({ where: { id: project.id }, data: { updatedAt: old } });
    const context = { params: Promise.resolve({ id: project.id, cardId: card.id }) };
    const patchResponse = await PATCH(new Request(`http://localhost/api/projects/${project.id}/cards/${card.id}`, {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({
        type: "risk",
        title: "修正后的检索风险",
        summary: "对照实验尚未完成，当前检索效果存在可验证的交付风险。",
        keywords: ["RAG", "baseline", "对照实验"],
        relatedTasks: ["完成对照实验"],
        nextActions: ["记录实验指标并同步结论"],
        importance: 5,
      }),
    }), context);
    expect(patchResponse.status).toBe(200);
    await expect(patchResponse.json()).resolves.toMatchObject({ card: { type: "risk", title: "修正后的检索风险", importance: 5 } });
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).updatedAt.getTime()).toBeGreaterThan(old.getTime());

    const crossProjectResponse = await PATCH(new Request(`http://localhost/api/projects/${otherProject.id}/cards/${card.id}`, {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({ title: "不应允许的跨项目修改" }),
    }), { params: Promise.resolve({ id: otherProject.id, cardId: card.id }) });
    expect(crossProjectResponse.status).toBe(404);
    await expect(crossProjectResponse.json()).resolves.toMatchObject({ error: { code: "CARD_NOT_FOUND" } });

    const relationCount = await db.cardRelation.count({ where: { OR: [{ currentCardId: card.id }, { relatedCardId: card.id }] } });
    if (relationCount === 0) {
      await db.cardRelation.create({ data: { currentCardId: card.id, relatedCardId: relatedCard.id, reason: "测试级联", score: 1 } });
    }
    await db.project.update({ where: { id: project.id }, data: { updatedAt: old } });
    const deleteResponse = await DELETE(new Request(`http://localhost/api/projects/${project.id}/cards/${card.id}`, {
      method: "DELETE",
      headers: auth.headers,
    }), context);
    expect(deleteResponse.status).toBe(204);
    expect(await db.capture.findUnique({ where: { id: card.captureId } })).toBeNull();
    expect(await db.knowledgeCard.findUnique({ where: { id: card.id } })).toBeNull();
    expect(await db.cardRelation.count({ where: { OR: [{ currentCardId: card.id }, { relatedCardId: card.id }] } })).toBe(0);
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).updatedAt.getTime()).toBeGreaterThan(old.getTime());
  });

  it("returns 404 instead of an empty artifact list for a missing project", async () => {
    const { GET } = await import("@/app/api/projects/[id]/artifacts/route");
    const { createTestAuth } = await import("./testAuthHelper");
    const auth = await createTestAuth();
    const response = await GET(new Request("http://localhost/api/projects/missing/artifacts", {
      headers: auth.headers,
    }), { params: Promise.resolve({ id: "missing" }) });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "PROJECT_NOT_FOUND" } });
  });

  it("persists proactive intervention, action completion and reflection trace", async () => {
    const { db } = await import("@/lib/db");
    const { createProject, getProjectDetail } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { evaluateProjectContext } = await import("@/lib/services/agentContextService");
    const { listInterventions, listActions } = await import("@/lib/repositories/agent");
    const { PATCH: patchIntervention } = await import("@/app/api/projects/[id]/interventions/[interventionId]/route");
    const { PATCH: patchAction } = await import("@/app/api/projects/[id]/actions/[actionId]/route");
    const { createTestAuth } = await import("./testAuthHelper");
    const project = await createProject({ title: "主动闭环集成测试", description: "验证主动提醒、行动回执和复盘卡片的完整持久化链路。", goal: "完成 Agent 闭环", scenario: "COMPETITION", deadline: null });
    const auth = await createTestAuth(project.id);
    await db.project.update({ where: { id: project.id }, data: { deadline: new Date(Date.now() + 2 * 86_400_000) } });
    await processCapture(project.id, "风险：演示脚本尚未完成，需要优先处理。", "风险记录");
    const evaluation = await evaluateProjectContext(project.id);
    expect(evaluation.interventions.length).toBeGreaterThan(0);
    const deadline = (await listInterventions(project.id, false)).find((item) => item.triggerType === "DEADLINE_NEAR");
    expect(deadline).toBeTruthy();
    const accepted = await patchIntervention(new Request("http://localhost", {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({ status: "ACCEPTED" }),
    }), { params: Promise.resolve({ id: project.id, interventionId: deadline!.id }) });
    expect(accepted.status).toBe(200);
    const acceptedData = await accepted.json() as { action: { id: string } };
    expect(acceptedData.action.id).toBeTruthy();
    const completed = await patchAction(new Request("http://localhost", {
      method: "PATCH",
      headers: auth.headers,
      body: JSON.stringify({ status: "DONE", resultText: "已完成最小交付清单并录制演示路径。" }),
    }), { params: Promise.resolve({ id: project.id, actionId: acceptedData.action.id }) });
    expect(completed.status).toBe(200);
    await expect(completed.json()).resolves.toMatchObject({ action: { status: "DONE", resultCardId: expect.any(String) } });
    const actions = await listActions(project.id);
    expect(actions.find((item) => item.id === acceptedData.action.id)?.status).toBe("DONE");
    expect((await getProjectDetail(project.id)).cards.some((card) => card.type === "reflection")).toBe(true);
    expect((await listInterventions(project.id)).find((item) => item.id === deadline!.id)?.status).toBe("RESOLVED");
  });

  it("keeps simulated interventions out of metrics and supports cleanup", async () => {
    const { createProject } = await import("@/lib/repositories/projects");
    const { evaluateProjectContext } = await import("@/lib/services/agentContextService");
    const { getProjectMetrics, listInterventions } = await import("@/lib/repositories/agent");
    const project = await createProject({ title: "模拟情境集成测试", description: "验证演示模拟数据拥有独立标记并且可以清理。", goal: "验证模拟器", scenario: "COMPETITION", deadline: null });
    const simulated = await evaluateProjectContext(project.id, { scenario: "stale_72h" });
    expect(simulated.interventions.some((item) => item.isSimulated)).toBe(true);
    expect((await getProjectMetrics(project.id)).interventionCount).toBe(0);
    await evaluateProjectContext(project.id, { clearSimulation: true });
    expect((await listInterventions(project.id)).filter((item) => item.isSimulated)).toHaveLength(0);
  });

  it("hides accepted and future-snoozed reminders until they need attention again", async () => {
    const { db } = await import("@/lib/db");
    const { createProject } = await import("@/lib/repositories/projects");
    const { evaluateProjectContext } = await import("@/lib/services/agentContextService");
    const { listInterventions, updateIntervention } = await import("@/lib/repositories/agent");
    const project = await createProject({ title: "提醒可见性项目", description: "这个项目用于验证稍后提醒和当前提醒可以正确分离。", goal: "验证提醒状态", scenario: "COMPETITION", deadline: null });
    await db.project.update({ where: { id: project.id }, data: { deadline: new Date(Date.now() + 2 * 86_400_000) } });
    await evaluateProjectContext(project.id);
    const reminder = (await listInterventions(project.id, false)).find((item) => item.triggerType === "DEADLINE_NEAR");
    expect(reminder).toBeTruthy();

    const future = new Date(Date.now() + 86_400_000).toISOString();
    await updateIntervention(project.id, reminder!.id, { status: "SNOOZED", snoozedUntil: future });
    expect((await listInterventions(project.id, false)).some((item) => item.id === reminder!.id)).toBe(false);
    expect((await listInterventions(project.id, true)).find((item) => item.id === reminder!.id)?.status).toBe("SNOOZED");

    await db.agentIntervention.update({ where: { id: reminder!.id }, data: { snoozedUntil: new Date(Date.now() - 1_000) } });
    expect((await listInterventions(project.id, false)).some((item) => item.id === reminder!.id)).toBe(true);
  });

  it("reuses card-sourced actions and exposes real dashboard aggregates", async () => {
    const { db } = await import("@/lib/db");
    const { createProject, getProjectDetail, listProjects } = await import("@/lib/repositories/projects");
    const { processCapture } = await import("@/lib/services/captureService");
    const { createOrReuseAction, updateAction } = await import("@/lib/repositories/agent");
    const project = await createProject({ title: "行动去重项目", description: "这个项目用于验证知识建议不会重复创建相同行动。", goal: "验证行动与总览", scenario: "COMPETITION", deadline: null });
    await processCapture(project.id, "需要在周五前完成 baseline 准确率实验并记录 loss。", "实验记录");
    const card = (await getProjectDetail(project.id)).cards[0];
    const input = { title: "完成 baseline 对照实验", description: "来自知识卡片", priority: 4, sourceCardId: card.id };
    const first = await createOrReuseAction(project.id, input);
    const second = await createOrReuseAction(project.id, input);
    expect(first.reused).toBe(false);
    expect(second).toMatchObject({ reused: true, action: { id: first.action.id } });
    const dueAt = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const updated = await updateAction(project.id, first.action.id, { priority: 5, dueAt });
    expect(updated.priority).toBe(5);
    expect(updated.dueAt?.toISOString()).toBe(dueAt);

    await db.actionItem.create({ data: { projectId: project.id, title: "模拟行动", priority: 5, isSimulated: true } });
    const listed = (await listProjects()).find((item) => item.id === project.id);
    expect(listed?.dashboard.activeActionCount).toBe(1);
    expect(listed?.dashboard.readiness.items.find((item) => item.key === "experiment")?.complete).toBe(true);
  });
});
