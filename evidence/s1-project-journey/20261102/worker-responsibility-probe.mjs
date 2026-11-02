// S1-B 持续责任：真实 Worker 隔离进程探针。
// Run from repository root: node --import tsx evidence/s1-project-journey/20261102/worker-responsibility-probe.mjs
//
// 只使用 OS 临时库与临时附件目录；显式关闭真实模型与外部写入，不消费开发/生产任务。
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { continuityDatabase } from "../../../tests/helpers/continuityDatabase.ts";

const isolated = continuityDatabase("s1-worker-responsibility");
const presencePath = path.join(isolated.dir, "presence.json");
Object.assign(process.env, {
  ATTACHMENT_DIR: path.join(isolated.dir, "attachments"),
  WORKER_PRESENCE_FILE: presencePath,
  PROJECTMEMO_RELEASE: "s1-isolated-worker-probe",
  LLM_API_KEY: "", LLM_MODE: "mock",
  MISSION_ENABLED: "true", MISSION_WRITES_ENABLED: "true",
  FOCUS_ASYNC_ENABLED: "false", FOCUS_WEB_ENABLED: "false",
  MISSION_EVENT_CONTINUATION_ENABLED: "false",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "false",
  MISSION_AUTO_CONTINUATION_ENABLED: "false",
  REPO_CI_OBSERVER_ENABLED: "false", DEPLOYMENT_OBSERVER_ENABLED: "false",
});
const { db } = await import("../../../lib/db.ts");
const { createSession } = await import("../../../lib/auth/session.ts");
const { createIntakeDraft, addFileMaterial } = await import("../../../lib/services/projectIntakeService.ts");
const { getAttachmentStorageDir } = await import("../../../lib/storage/attachmentStorage.ts");
const { readWorkerPresence } = await import("../../../lib/mission/workerPresence.ts");
const { createMission } = await import("../../../lib/mission/missionService.ts");

function worker() {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/mission-worker.ts", "--once"], {
    cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 90_000, windowsHide: true,
  });
  assert.equal(result.error, undefined, "worker process must finish within the bounded probe");
  return result;
}

try {
  const user = await db.user.create({ data: { username: "s1-worker-owner", displayName: "S1 隔离进程探针", passwordHash: "unused" } });
  const { session } = await createSession(user.id);
  const actor = { userId: user.id, sessionId: session.id };
  const project = await db.project.create({ data: { title: "持续责任隔离项目", description: "OS 临时目录中的合成项目",
    goal: "验证原 Worker 的等待、失败与清理", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } } } });

  // 1. 项目前材料的真实临时原件：到期后由原 Worker 清理。
  const draft = await createIntakeDraft(actor, { requestId: "probe-draft" });
  const material = await addFileMaterial(actor, draft.draftId, {
    fileName: "probe.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nsynthetic probe material"),
  }, { requestId: "probe-material" });
  assert.ok(material.materialId);
  const stored = await db.projectIntakeMaterial.findFirstOrThrow({ where: { draftId: draft.draftId } });
  assert.ok(stored.storageKey, "临时原件必须先真实落盘");
  const tempFile = path.join(getAttachmentStorageDir(), stored.storageKey);
  assert.equal(fs.existsSync(tempFile), true);
  await db.projectIntakeDraft.update({ where: { id: draft.draftId }, data: { expiresAt: new Date(Date.now() - 1000) } });

  // 2. 未到检查时间的委托保持 READY，工作进程不领取、不调用模型。
  const notDue = await createMission(user.id, { projectId: project.id, requestId: "probe-not-due", goal: "等待下一次检查",
    llmContextApproved: false });
  await db.agentMission.update({ where: { id: notDue.id }, data: {
    status: "READY", nextAttemptAt: new Date(Date.now() + 3_600_000) } });

  // 3. 已到期但未获云上下文批准的委托：必须显式失败并暂停，不能显示为“无变化”。
  const due = await createMission(user.id, { projectId: project.id, requestId: "probe-due", goal: "到期接口核对",
    llmContextApproved: false });
  await db.agentMission.update({ where: { id: due.id }, data: { status: "READY", nextAttemptAt: null } });

  // 4. 用户暂停的委托不会被后台复活。
  const paused = await createMission(user.id, { projectId: project.id, requestId: "probe-paused", goal: "用户暂停",
    llmContextApproved: false });
  await db.agentMission.update({ where: { id: paused.id }, data: { status: "PAUSED", pauseReason: "USER",
    pauseRequestedAt: new Date() } });

  const modelRunsBefore = await db.agentRun.count({ where: { projectId: project.id } });
  const first = worker();
  assert.equal(first.status, 0, first.stderr);

  // 清理：真实删除临时原件并把草稿标为到期。
  const expiredDraft = await db.projectIntakeDraft.findUniqueOrThrow({ where: { id: draft.draftId } });
  assert.equal(expiredDraft.status, "EXPIRED");
  assert.equal(fs.existsSync(tempFile), false, "原 Worker 必须真实删除到期临时原件");
  const purged = await db.projectIntakeMaterial.findUniqueOrThrow({ where: { id: material.materialId } });
  assert.equal(purged.rawText, null);
  assert.equal(purged.cleanupState, "DELETED");

  // 未到期：保持原状态，没有 CLAIMED 事件。
  const stillWaiting = await db.agentMission.findUniqueOrThrow({ where: { id: notDue.id } });
  assert.equal(stillWaiting.status, "READY");
  assert.equal(await db.agentMissionEvent.count({ where: { missionId: notDue.id, type: "CLAIMED" } }), 0,
    "未到检查时间的委托不能被工作进程领取");

  // 到期但缺云上下文批准：暂停并保留明确失败原因，不发起模型调用。
  const failed = await db.agentMission.findUniqueOrThrow({ where: { id: due.id } });
  assert.equal(failed.status, "PAUSED");
  assert.equal((failed.lastErrorJson ?? {}).code, "LLM_CONTEXT_NOT_APPROVED");
  assert.equal(await db.agentMissionEvent.count({ where: { missionId: due.id, type: "CLAIMED" } }), 1);

  // 用户暂停：不领取、不复活。
  const stillPaused = await db.agentMission.findUniqueOrThrow({ where: { id: paused.id } });
  assert.equal(stillPaused.status, "PAUSED");
  assert.equal(await db.agentMissionEvent.count({ where: { missionId: paused.id, type: "CLAIMED" } }), 0);

  // 没有模型成功回执：mock/未配置模式下不能出现“已调用模型”。
  const modelRunsAfter = await db.agentRun.count({ where: { projectId: project.id, runType: "CHAT", status: "SUCCESS" } });
  assert.equal(modelRunsAfter, 0, "缺云上下文批准时不得产生成功模型回执");

  // 第二轮：同一批状态不再重新领取，清理保持幂等。
  const second = worker();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(await db.agentMissionEvent.count({ where: { missionId: due.id, type: "CLAIMED" } }), 1,
    "已暂停的委托第二轮不能被重新领取");
  const presence = readWorkerPresence();
  assert.equal(presence.identityMatches, true);
  const runs = await db.agentRun.count({ where: { projectId: project.id } });

  console.log(JSON.stringify({
    outcome: "PASS", data: "synthetic; isolated OS-temp database, attachments and presence file",
    worker: "original scripts/mission-worker.ts --once; two actual child processes",
    model: "mock; no API key; mission queue enabled only for claim/guard assertions",
    assertions: [
      "到期临时原件被真实删除，草稿 EXPIRED、材料清理身份保留",
      "未到检查时间的委托保持 READY 且无 CLAIMED 事件",
      "缺云上下文批准的到期委托 PAUSED 且错误码明确",
      "用户暂停的委托不被后台复活",
      "没有成功模型回执，不把未调用显示成已检查",
      "第二轮进程不重复领取、清理幂等",
      `项目 AgentRun 行数：首次前 ${modelRunsBefore}，两轮后 ${runs}`,
    ],
    limits: ["Windows 进程探针", "非 Linux/systemd", "无设备或自然日验收", "未调用真实模型", "下一检查时间由夹具设置，非自然日积累"],
  }, null, 2));
} finally {
  await db.$disconnect();
  fs.rmSync(isolated.dir, { recursive: true, force: true });
}

