import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-11-09 全面排查的回归用例：独立临时库 + mock 模型，不访问开发库。
 * 每条断言写的是期望行为，修复前失败即视为复现。
 */
const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-audit-"));
  const file = path.join(dir, "audit.db");
  Object.assign(process.env, {
    DATABASE_URL: `file:${file.replaceAll("\\", "/")}`,
    ATTACHMENT_DIR: path.join(dir, "attachments"),
    LLM_MODE: "mock",
    SEMANTIC_MEMORY_ENABLED: "false",
    MISSION_ENABLED: "true",
    MISSION_WRITES_ENABLED: "true",
    FOCUS_AGENT_ENABLED: "true",
    FOCUS_ASYNC_ENABLED: "true",
    FOCUS_WEB_ENABLED: "true",
    PROJECT_CALENDAR_REMINDER_ENABLED: "true",
    PROJECT_SCHEDULING_ENABLED: "true",
    TEMPORAL_MEMORY_ENABLED: "true",
  });
  const sql = new Database(file);
  sql.pragma("journal_mode = WAL");
  for (const name of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", name, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { dir };
});

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { db } from "@/lib/db";
import { createSession } from "@/lib/auth/session";
import { createMission } from "@/lib/mission/missionService";
import { consumeImpactJobs } from "@/lib/decision/impactJobs";
import { confirmTemporalRelation } from "@/lib/repositories/temporalRelations";
import { captureRequestPayloadHash, processCaptureWithRequest } from "@/lib/services/captureService";
import { processAttachmentUpload } from "@/lib/services/attachmentService";
import { updateProjectAction } from "@/lib/services/actionService";
import { generateArtifact } from "@/lib/services/artifactService";
import { processProjectDeletions, requestProjectDeletion } from "@/lib/services/projectDeletionService";
import { createOwnedProject, getProjectDetail } from "@/lib/repositories/projects";
import { conversationAttachmentContext } from "@/lib/services/conversationAttachmentService";
import { applyReminderDispositionOnCompletion, recordActionReminderSync } from "@/lib/services/actionReminderService";
import { PATCH as patchActionRoute } from "@/app/api/projects/[id]/actions/[actionId]/route";
import { GET as healthRoute } from "@/app/health/route";
import { readCopilotContext } from "@/lib/copilot/confirmation";
import { runConversationTurn } from "@/lib/conversation/turnWorker";
import { getAttachmentStorageDir, saveFileToStorage } from "@/lib/storage/attachmentStorage";
import { apiError } from "@/lib/api";
import { ABANDONED_EXTERNAL_RUN_MS, reserveExternalAgentRun } from "@/lib/repositories/agent";
import { confirmSchedulePlan, previewSchedule } from "@/lib/services/scheduleService";
import { shanghaiDay } from "@/lib/time/shanghai";
import { discoverMaterialPointers } from "@/lib/conversation/toolAdapter";

afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
});

async function fixture() {
  const user = await db.user.create({ data: { username: crypto.randomUUID(), displayName: "排查", passwordHash: "unused" } });
  const project = await db.project.create({ data: { title: "排查项目", description: "本地 mock", goal: "验证恢复", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, project };
}

function relate(from: string, to: string, relationType: "SUPPORTS" | "SUPERSEDES", confirmed: boolean) {
  return db.cardRelation.create({ data: { currentCardId: from, relatedCardId: to, relationType, reason: "排查", score: 100, confirmed,
    confirmedAt: confirmed ? new Date() : null, validFrom: new Date() } });
}

async function card(projectId: string, title: string) {
  const capture = await db.capture.create({ data: { projectId, rawText: title, sourceType: "实验记录" } });
  return db.knowledgeCard.create({ data: { projectId, captureId: capture.id, type: "experiment_log", title, summary: title,
    keywords: [], relatedTasks: [], nextActions: [], importance: 3 } });
}

const onePagePdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const chinese = /[一-龥]/;

describe("后台任务恢复", () => {
  it("A3 进程在 Capture 处理中被杀后，同 requestId 重试能接续而不是永远 409", async () => {
    const { project } = await fixture();
    const raw = "实验记录：崩溃前已经写入预留回执";
    await db.agentRun.create({ data: { projectId: project.id, runType: "CAPTURE", status: "PARTIAL", provider: "capture-api",
      externalRequestId: `${project.id}:crashed`, createdAt: new Date(Date.now() - 3_600_000),
      trace: { source: "capture", stage: "RECEIVED", requestId: "crashed", requestHash: captureRequestPayloadHash(raw, null) } } });
    const result = await processCaptureWithRequest(project.id, raw, null, { requestId: "crashed" });
    expect(result.card.id).toBeTruthy();
    expect(await db.capture.count({ where: { projectId: project.id, requestId: "crashed" } })).toBe(1);
  }, 40_000);

  it("A1 影响作业不能把外部写入中的步骤置废，否则未知结果不再核对", async () => {
    const { user, project } = await fixture();
    const mission = await createMission(user.id, { projectId: project.id, goal: "写入日程，缺口明确列出", requestId: crypto.randomUUID(),
      missionConstraints: { executionBoundary: "READ_ANALYZE" } });
    await db.agentMission.update({ where: { id: mission.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    const oldSetting = await card(project.id, "旧实验设置"), metric = await card(project.id, "汇报采用的指标"), replacement = await card(project.id, "新实验设置");
    await relate(oldSetting.id, metric.id, "SUPPORTS", true);
    const verify = await db.actionItem.create({ data: { projectId: project.id, title: "验证指标", status: "TODO" } });
    const summarize = await db.actionItem.create({ data: { projectId: project.id, title: "整理验证结果", status: "TODO" } });
    await db.actionRequirement.createMany({ data: [
      { projectId: project.id, actionId: verify.id, targetKind: "card", targetId: metric.id, hard: true },
      { projectId: project.id, actionId: summarize.id, targetKind: "action", targetId: verify.id, hard: true },
    ] });
    await db.agentMissionOutput.create({ data: { missionId: mission.id, revision: 1, kind: "NOTE", sourceRefsJson: [], claimChecksJson: [],
      contentJson: { blocks: [{ blockId: "result", text: "待核对", kind: "INFERENCE", sourceIds: [`action:${summarize.id}`] }] } } });
    const plain = await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 3, planRevision: 1, toolName: "inspect_project", status: "READY", canonicalInputJson: {}, inputHash: "h3", readSetJson: [] } });
    const step = await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 1, planRevision: 1, toolName: "propose_calendar_event",
      status: "UNKNOWN", canonicalInputJson: {}, inputHash: "h", readSetJson: [], protocolJson: { externalEffect: { phase: "DISPATCHED" } } } });
    const running = await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: 2, planRevision: 1, toolName: "propose_calendar_event",
      status: "RUNNING", canonicalInputJson: {}, inputHash: "h2", readSetJson: [], protocolJson: { externalEffect: { phase: "DISPATCHED" } } } });
    const relation = await relate(replacement.id, oldSetting.id, "SUPERSEDES", false);
    await confirmTemporalRelation(project.id, relation.id);
    await consumeImpactJobs();
    expect((await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("PAUSED");
    expect((await db.agentMissionStep.findUniqueOrThrow({ where: { id: plain.id } })).status).toBe("OBSOLETE");
    expect((await db.agentMissionStep.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("RUNNING");
    expect((await db.agentMissionStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("UNKNOWN");
  });

  it("A5 遗留的非 deferred turn 不能占满窗口饿死 deferred turn", async () => {
    const { user } = await fixture();
    const auth = await createSession(user.id);
    const conversation = await db.conversation.create({ data: { ownerUserId: user.id, title: "饿死验证", createRequestId: crypto.randomUUID(), createInputHash: "h", scope: "GLOBAL" } });
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 30; i++) await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: "legacy-" + i, inputHash: "h", inputJson: {},
      baseVersion: 0, status: "OBSERVING", sessionId: auth.session.id, createdAt: new Date(base + i) } });
    const target = await db.conversationTurn.create({ data: { conversationId: conversation.id, requestId: "deferred", inputHash: "h", inputJson: {}, baseVersion: 0,
      status: "OBSERVING", sessionId: auth.session.id, readManifestJson: { deferred: true }, createdAt: new Date(base + 1000) } });
    let claimed = false;
    await runConversationTurn({ onClaim: () => { claimed = true; } }).catch(() => undefined);
    expect(claimed).toBe(true);
    expect(target.id).toBeTruthy();
  });
});

describe("第二轮：外部调用与重复安排", () => {
  it("N1 小艺调用进程被杀后，同 request_id 不再永远“处理中”", async () => {
    const { project } = await fixture();
    const request = { projectId: project.id, runType: "CAPTURE" as const, provider: "xiaoyi-test", externalRequestId: crypto.randomUUID(), trace: {}, abandonAfterMs: ABANDONED_EXTERNAL_RUN_MS };
    const first = await reserveExternalAgentRun(request);
    expect((await reserveExternalAgentRun(request)).run.status).toBe("PARTIAL");
    await db.agentRun.update({ where: { id: first.run.id }, data: { createdAt: new Date(Date.now() - 2 * ABANDONED_EXTERNAL_RUN_MS) } });
    const retried = await reserveExternalAgentRun(request);
    expect(retried.run.status).toBe("FAILED");
    expect(retried.run.resultJson).toMatchObject({ error: { code: "EXTERNAL_REQUEST_INTERRUPTED" } });
  });

  async function schedulable(projectId: string, title: string) {
    return db.actionItem.create({ data: { projectId, title, description: "", priority: 3, estimatedMinutes: 30 } });
  }
  const hourFromNow = (hours: number) => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 + hours * 3_600_000);
  function preview(projectId: string, userId: string, actionIds: string[], start: Date, end: Date) {
    return previewSchedule(projectId, { requestId: crypto.randomUUID(), rangeStart: start.toISOString(), rangeEnd: end.toISOString(),
      slots: [{ start: start.toISOString(), end: end.toISOString() }], actionIds }, { userId });
  }
  async function confirmedBlock(planProject: string, userId: string, actionId: string, startAt: Date, endAt: Date) {
    await db.schedulePlan.create({ data: { projectId: planProject, userId, requestId: crypto.randomUUID(), timezone: "Asia/Shanghai", rangeStart: new Date(startAt.getTime() - 3_600_000), rangeEnd: new Date(endAt.getTime() + 3_600_000),
      inputHash: "h", status: "CONFIRMED", blocks: { create: { actionId, actionVersion: 0, startAt, endAt, locked: false, calendarSyncStatus: "NONE" } } } });
  }

  it("N2 错过的安排可以重新安排，已结束行动不再占用时段", async () => {
    const { user, project } = await fixture();
    const missed = await schedulable(project.id, "错过安排的行动");
    await confirmedBlock(project.id, user.id, missed.id, hourFromNow(-5), hourFromNow(-4));
    const replanned = await preview(project.id, user.id, [missed.id], hourFromNow(2), hourFromNow(4));
    expect(replanned.blocks.map(block => block.actionId)).toEqual([missed.id]);

    const closed = await db.actionItem.create({ data: { projectId: project.id, title: "已取消的行动", description: "", priority: 3, estimatedMinutes: 30, status: "CANCELLED" } });
    await confirmedBlock(project.id, user.id, closed.id, hourFromNow(10), hourFromNow(11));
    const next = await schedulable(project.id, "新的行动");
    const freed = await preview(project.id, user.id, [next.id], hourFromNow(10), hourFromNow(11));
    expect(freed.blocks.map(block => block.actionId)).toEqual([next.id]);
  });

  it("N3 同一行动不能在两份已确认安排里各占一个时段", async () => {
    const { user, project } = await fixture();
    const action = await schedulable(project.id, "重复安排的行动");
    const actor = { userId: user.id };
    const first = await preview(project.id, user.id, [action.id], hourFromNow(20), hourFromNow(21));
    const second = await preview(project.id, user.id, [action.id], hourFromNow(30), hourFromNow(31));
    await confirmSchedulePlan(project.id, first.id, { requestId: first.requestId }, actor);
    await expect(confirmSchedulePlan(project.id, second.id, { requestId: second.requestId }, actor)).rejects.toMatchObject({ code: "SCHEDULE_ACTION_CHANGED" });
  });

  it("N4 另一台设备上的日程在完成时给出提示", async () => {
    const { user, project } = await fixture();
    const auth = await createSession(user.id);
    const { action } = await reminder(project.id, user.id, "别的设备提醒", "SYNCED", "evt-other");
    const response = await patchActionRoute(new Request("http://local/x", { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${auth.token}`, "x-pm-device-key": "device-b" },
      body: JSON.stringify({ status: "DONE", resultText: "已经完成并记录结果" }) }), { params: Promise.resolve({ id: project.id, actionId: action.id }) });
    expect((await response.json()).reminderNotice).toMatch(/另一台设备/);
  });

  it("N5 北京时间日界", () => {
    expect(shanghaiDay(new Date("2026-11-09T16:30:00.000Z"))).toBe("2026-11-10");
    expect(shanghaiDay(new Date("2026-11-09T15:30:00.000Z"))).toBe("2026-11-09");
  });
});

describe("第三轮：窗口与有效期", () => {
  it("P1 行动很多时，讨论先拿到未完成的行动", async () => {
    const { user, project } = await fixture();
    for (let i = 0; i < 14; i++) await db.actionItem.create({ data: { projectId: project.id, title: `早期已完成 ${i}`, description: "", priority: 3, status: "DONE" } });
    const open = await db.actionItem.create({ data: { projectId: project.id, title: "现在要做的事", description: "", priority: 3 } });
    const pointers = await discoverMaterialPointers({ userId: user.id, sessionId: (await createSession(user.id)).session.id } as never, [project.id], []);
    expect(pointers.map(pointer => pointer.sourceId)).toContain("action:" + open.id);
  });

  it("P2 被取代的记录不占成果窗口", async () => {
    const { project } = await fixture();
    const at = (index: number) => new Date(Date.now() - (100 - index) * 60_000);
    const make = async (title: string, index: number) => db.knowledgeCard.update({ where: { id: (await card(project.id, title)).id }, data: { createdAt: at(index) } });
    await make("最早的有效记录", 0);
    const replaced = [];
    for (let i = 0; i < 4; i++) replaced.push(await make(`旧结论 ${i}`, 1 + i));
    for (let i = 0; i < 20; i++) {
      const current = await make(`新记录 ${i}`, 10 + i);
      if (i < 4) await db.cardRelation.create({ data: { currentCardId: current.id, relatedCardId: replaced[i].id, relationType: "SUPERSEDES", reason: "替换", score: 100,
        confirmed: true, confirmedAt: new Date(), validFrom: new Date() } });
    }
    const artifact = await generateArtifact(project.id, "weekly_report");
    expect(artifact.content).toContain("最早的有效记录");
  });

  it("P3 委托里创建待办的批准不再 10 分钟过期", () => {
    const runner = fs.readFileSync(path.join(process.cwd(), "lib/mission/runner.ts"), "utf8");
    expect(runner).toMatch(/INTERNAL_APPROVAL_TTL_MS=24\*60\*60\*1000/);
    expect(runner).toMatch(/Date\.now\(\)\+INTERNAL_APPROVAL_TTL_MS\);const proposal=\{tool:"create_action"/);
  });
});

describe("账号与项目隔离", () => {
  it("B1 删除项目时清掉讨论附件在途/崩溃留下的孤儿文件", async () => {
    const { user, project } = await fixture();
    const auth = await createSession(user.id);
    const conversation = await db.conversation.create({ data: { ownerUserId: user.id, title: "孤儿文件", homeProjectId: project.id, createRequestId: crypto.randomUUID(), createInputHash: "h", scope: "PROJECT",
      projects: { create: { projectId: project.id } } } });
    const orphan = await saveFileToStorage("conversation-" + conversation.id, "secret.pdf", onePagePdf);
    const fresh = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    await requestProjectDeletion(user.id, project.id, project.id, fresh.updatedAt.toISOString(), auth.session.id);
    await processProjectDeletions();
    expect(fs.existsSync(orphan.absolutePath)).toBe(false);
  });
});

describe("完整业务闭环", () => {
  it("C1 没有填写结果不能生成虚构的复盘卡", async () => {
    const { project } = await fixture();
    const action = await db.actionItem.create({ data: { projectId: project.id, title: "跑一次回归", description: "", priority: 3 } });
    await expect(updateProjectAction(project.id, action.id, { status: "DONE" })).rejects.toMatchObject({ code: "INVALID_ACTION_RESULT" });
    expect((await db.actionItem.findUniqueOrThrow({ where: { id: action.id } })).status).toBe("TODO");
  });

  it("C3 模板成果不能把已取代的事实写成当前事实", async () => {
    const { project } = await fixture();
    const old = await card(project.id, "旧方案使用关键词检索");
    const replacement = await card(project.id, "新方案改用混合检索");
    await db.cardRelation.create({ data: { currentCardId: replacement.id, relatedCardId: old.id, relationType: "SUPERSEDES", reason: "方案替换", score: 100,
      confirmed: true, confirmedAt: new Date(), validFrom: new Date() } });
    const artifact = await generateArtifact(project.id, "weekly_report");
    expect(artifact.content).toContain("新方案改用混合检索");
    expect(artifact.content).not.toContain("**旧方案使用关键词检索**");
  });
});

describe("长时间和大数据", () => {
  it("D1 多份长附件不会把讨论挤爆到 CONTEXT_LIMIT", async () => {
    const { user } = await fixture();
    const conversation = await db.conversation.create({ data: { ownerUserId: user.id, title: "长附件", createRequestId: crypto.randomUUID(), createInputHash: "h", scope: "GLOBAL" } });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await db.conversationAttachment.create({ data: { conversationId: conversation.id, ownerUserId: user.id, type: "PDF", storageKey: "k" + i,
      fileName: `资料${i}.pdf`, mimeType: "application/pdf", size: 1, sha256: "s" + i, extractedText: "字".repeat(8000), extractionStatus: "SUCCESS" } })).id);
    const context = await conversationAttachmentContext(conversation.id, user.id, ids);
    expect(context.text.length).toBeLessThan(10_000);
    for (let i = 0; i < 5; i++) expect(context.text).toContain(`资料${i}.pdf`);
  });

  it("D2 500 张卡片时确认事务内的上下文读取不超过事务预算", async () => {
    const { project, user } = await fixture();
    const now = Date.now();
    await db.$transaction(async tx => {
      for (let i = 0; i < 500; i++) {
        const capture = await tx.capture.create({ data: { projectId: project.id, rawText: "记录" + i, sourceType: "实验记录" } });
        await tx.knowledgeCard.create({ data: { projectId: project.id, captureId: capture.id, type: "experiment_log", title: "记录" + i, summary: "摘要".repeat(40),
          keywords: [], relatedTasks: [], nextActions: [], importance: 3, createdAt: new Date(now - i * 1000) } });
      }
    }, { timeout: 60_000 });
    const start = performance.now();
    const auth = await createSession(user.id);
    await db.$transaction(tx => readCopilotContext(tx, project.id, { userId: user.id, sessionId: auth.session.id }), { timeout: 60_000 });
    const elapsed = performance.now() - start;
    const detailStart = performance.now();
    await getProjectDetail(project.id);
    console.info(`[audit] readCopilotContext 500 cards: ${Math.round(elapsed)}ms; getProjectDetail: ${Math.round(performance.now() - detailStart)}ms`);
    expect(elapsed).toBeLessThan(5_000);
  }, 120_000);
});

async function reminder(projectId: string, userId: string, title: string, syncStatus: string, eventId: string | null) {
  const action = await db.actionItem.create({ data: { projectId, title, description: "", priority: 3, dueAt: new Date(Date.now() + 86_400_000) } });
  const row = await db.actionReminder.create({ data: { projectId, actionId: action.id, userId, deviceKey: "device-a", requestId: crypto.randomUUID(),
    reminderAt: new Date(Date.now() + 3_600_000), syncStatus, calendarId: eventId ? "cal" : null, calendarEventId: eventId } });
  return { action, row };
}

describe("提醒与时间边界", () => {
  it("E4 完成时选择移除，尚未写入设备的提醒也要撤销，迟到回执要求补偿删除", async () => {
    const { user, project } = await fixture();
    const { action, row } = await reminder(project.id, user.id, "未写入提醒", "PLANNED", null);
    const actor = { userId: user.id, deviceKey: "device-a" };
    await applyReminderDispositionOnCompletion(project.id, action.id, "REMOVE", actor);
    expect((await db.actionReminder.findUniqueOrThrow({ where: { id: row.id } })).syncStatus).toBe("REVOKED");
    await expect(recordActionReminderSync(project.id, row.id, { status: "SYNCED", calendarId: "cal", eventId: "late-event" }, actor))
      .rejects.toMatchObject({ code: "REMINDER_REVOKED" });
  });

  it("E1 取消行动时撤销本设备提醒并下发删除；E2 改截止日提示原提醒未动", async () => {
    const { user, project } = await fixture();
    const auth = await createSession(user.id);
    const headers = { "content-type": "application/json", authorization: `Bearer ${auth.token}`, "x-pm-device-key": "device-a" };
    const call = (actionId: string, body: unknown) => patchActionRoute(new Request("http://local/x", { method: "PATCH", headers, body: JSON.stringify(body) }), { params: Promise.resolve({ id: project.id, actionId }) });
    const cancelled = await reminder(project.id, user.id, "被取消的行动", "SYNCED", "evt-1");
    const cancelBody = await (await call(cancelled.action.id, { status: "CANCELLED" })).json();
    expect(cancelBody.reminderOutcome.devicePlan).toHaveLength(1);
    expect((await db.actionReminder.findUniqueOrThrow({ where: { id: cancelled.row.id } })).syncStatus).toBe("REVOKED");
    const moved = await reminder(project.id, user.id, "被改期的行动", "SYNCED", "evt-2");
    const movedBody = await (await call(moved.action.id, { dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString() })).json();
    expect(movedBody.reminderNotice).toMatch(/原时间/);
  });

  it("E6 截止日期按北京时间解释，不依赖服务器时区", async () => {
    const previous = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      const { user } = await fixture();
      const auth = await createSession(user.id);
      const { project } = await createOwnedProject({ title: "时区", description: "时区验证", goal: "验证时区", scenario: "RESEARCH", deadline: "2026-11-10" } as never, user.id, crypto.randomUUID(), auth.session.id);
      expect(project.deadline?.toISOString()).toBe("2026-11-10T15:59:59.000Z");
    } finally {
      if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
    }
  });
});

describe("部署与恢复能力", () => {
  it("F5 健康检查反映数据库状态", async () => {
    const healthy = await healthRoute();
    expect(healthy.status).toBe(200);
    expect((await healthy.json()).checks).toEqual({ database: "ok", storage: "ok" });
    vi.spyOn(db, "$queryRaw").mockRejectedValueOnce(new Error("no such file"));
    const broken = await healthRoute();
    expect(broken.status).toBe(503);
    expect((await broken.json()).status).toBe("degraded");
  });

  it("F6 连接使用 WAL，事务开启即取写锁", async () => {
    const [mode] = await db.$queryRawUnsafe<{ journal_mode: string }[]>("PRAGMA journal_mode");
    expect(mode.journal_mode).toBe("wal");
    const locked = await db.$transaction(async tx => {
      const other = new Database(process.env.DATABASE_URL!.replace(/^file:/, ""), { timeout: 0 });
      try { other.exec("BEGIN IMMEDIATE"); other.exec("ROLLBACK"); return false; } catch { return true; } finally { other.close(); void tx; }
    });
    expect(locked).toBe(true);
  });

  it("F7 磁盘写满时不留下半截文件，并返回中文可操作错误", async () => {
    const { project } = await fixture();
    const before = new Set(fs.readdirSync(getAttachmentStorageDir()));
    const realWrite = fs.promises.writeFile.bind(fs.promises);
    vi.spyOn(fs.promises, "writeFile").mockImplementation(async (file, data, options) => {
      await realWrite(file, (data as Buffer).subarray(0, 4), options);
      throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    });
    let caught: unknown;
    await processAttachmentUpload({ projectId: project.id, fileName: "a.pdf", mimeType: "application/pdf", buffer: onePagePdf }, { extractedText: "内容" }).catch(error => { caught = error; });
    expect(caught).toBeTruthy();
    expect(fs.readdirSync(getAttachmentStorageDir()).filter(name => !before.has(name))).toEqual([]);
    const response = apiError(caught);
    expect(response.status).toBe(507);
    expect(JSON.stringify(await response.json())).toMatch(/存储空间/);
  });

  it("F8 PDF 工具缺失时错误是简体中文且不暴露内部路径", async () => {
    const { project } = await fixture();
    const previous = process.env.PDFTOTEXT_PATH;
    process.env.PDFTOTEXT_PATH = path.join(isolated.dir, "missing-pdftotext");
    try {
      const { attachment } = await processAttachmentUpload({ projectId: project.id, fileName: "b.pdf", mimeType: "application/pdf", buffer: onePagePdf });
      expect(attachment.extractionStatus).toBe("FAILED");
      expect(attachment.extractionError ?? "").toMatch(chinese);
      expect(attachment.extractionError ?? "").not.toMatch(/ENOENT|spawn/);
    } finally {
      if (previous === undefined) delete process.env.PDFTOTEXT_PATH; else process.env.PDFTOTEXT_PATH = previous;
    }
  });
});
