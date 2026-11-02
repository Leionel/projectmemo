// Run from repository root with: node --import tsx evidence/s0-trust/20261102/worker-process-probe.mjs
// Synthetic data only; the helper creates a new OS-temp database before importing lib/db.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { continuityDatabase } from "../../../tests/helpers/continuityDatabase.ts";

const isolated = continuityDatabase("s0-worker-process");
Object.assign(process.env, {
  ATTACHMENT_DIR: path.join(isolated.dir, "attachments"),
  WORKER_PRESENCE_FILE: path.join(isolated.dir, "presence.json"),
  PROJECTMEMO_RELEASE: "s0-isolated-process-probe",
  LLM_API_KEY: "", LLM_MODE: "mock", MISSION_ENABLED: "false", MISSION_WRITES_ENABLED: "false",
  FOCUS_ASYNC_ENABLED: "false", MISSION_EVENT_CONTINUATION_ENABLED: "false",
  MISSION_INVESTIGATION_DELEGATION_ENABLED: "false",
});
const { db } = await import("../../../lib/db.ts");
const { createSession } = await import("../../../lib/auth/session.ts");
const { requestProjectDeletion, projectDeletionStatus } = await import("../../../lib/services/projectDeletionService.ts");
const { saveFileToStorage } = await import("../../../lib/storage/attachmentStorage.ts");
const { readWorkerPresence } = await import("../../../lib/mission/workerPresence.ts");
const worker = () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/mission-worker.ts", "--once"], {
    cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 60_000, windowsHide: true,
  });
  assert.equal(result.error, undefined, "worker process must finish within the bounded probe");
  return result;
};
try {
  const user = await db.user.create({ data: { username: "synthetic-worker-owner", displayName: "隔离进程探针", passwordHash: "unused" } });
  const { session } = await createSession(user.id);
  const project = await db.project.create({ data: {
    title: "合成清理责任", goal: "验证原进程失败与恢复", description: "OS 临时目录中的合成项目", scenario: "RESEARCH",
    memberships: { create: { userId: user.id, role: "OWNER" } },
  } });
  const file = await saveFileToStorage(project.id, "synthetic.txt", Buffer.from("synthetic worker deletion probe"));
  await db.attachment.create({ data: { projectId: project.id, type: "FILE", fileName: "synthetic.txt", mimeType: "text/plain", ...{
    storageKey: file.storageKey, size: file.size, sha256: file.sha256,
  } } });
  const requested = await requestProjectDeletion(user.id, project.id, project.id, project.updatedAt.toISOString(), session.id);
  assert.equal(requested.status, "PENDING");
  assert.equal(await db.projectMembership.count({ where: { projectId: project.id } }), 0);

  // Real scanner failure, not a fabricated presence record. The table rename is restricted to this new database.
  await db.$executeRawUnsafe('ALTER TABLE "AgentRun" RENAME TO "S0ProbeAgentRun"');
  const failed = worker();
  assert.equal(failed.status, 1);
  const failurePresence = readWorkerPresence();
  assert.equal(failurePresence.failedPhase, "PROJECT_CLEANUP");
  assert.equal(failurePresence.isActivelyInspecting, false);
  assert.equal(fs.existsSync(file.absolutePath), true);
  await db.$executeRawUnsafe('ALTER TABLE "S0ProbeAgentRun" RENAME TO "AgentRun"');

  const recovered = worker();
  assert.equal(recovered.status, 0, recovered.stderr);
  const successPresence = readWorkerPresence();
  assert.notEqual(failurePresence.workerId, successPresence.workerId);
  assert.equal(successPresence.identityMatches, true);
  assert.equal(successPresence.isActivelyInspecting, true);
  assert.equal(successPresence.failedPhase, null);
  const receipt = await projectDeletionStatus(user.id, project.id);
  assert.equal(receipt.receiptId, requested.receiptId);
  assert.equal(receipt.status, "COMPLETED");
  assert.equal(fs.existsSync(file.absolutePath), false);
  assert.equal(await db.project.count({ where: { id: project.id } }), 0);

  const idempotent = worker();
  assert.equal(idempotent.status, 0);
  assert.equal((await projectDeletionStatus(user.id, project.id)).receiptId, requested.receiptId);
  const stale = readWorkerPresence(Date.now() + 61_000);
  assert.equal(stale.status, "STALE");
  assert.equal(stale.isActivelyInspecting, false);
  process.env.PROJECTMEMO_RELEASE = "different-release";
  assert.equal(readWorkerPresence().mismatchReason, "RELEASE_MISMATCH");
  console.log(JSON.stringify({ outcome: "PASS", data: "synthetic; isolated OS-temp database and attachments",
    worker: "original scripts/mission-worker.ts --once; three actual child processes", model: "mock; execution features disabled",
    assertions: ["actual scanner failure exits 1", "failure never displays successful scan", "new worker identity after restart",
      "pending deletion completes with original receipt and actual unlink", "repeat worker remains idempotent",
      "stale heartbeat is not active", "mismatched release is rejected"],
    limits: ["Windows process probe", "no Linux/systemd", "no device or natural-day acceptance", "no model task claim asserted"],
  }, null, 2));
} finally {
  await db.$disconnect();
}
