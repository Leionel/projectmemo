import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordWorkerPresence, readWorkerPresence, clearWorkerPresenceForTest } from "@/lib/mission/workerPresence";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-s0-presence-"));
afterEach(() => { clearWorkerPresenceForTest(); vi.unstubAllEnvs(); });
function setup() { vi.stubEnv("WORKER_PRESENCE_FILE", path.join(dir, "presence.json")); vi.stubEnv("PROJECTMEMO_RELEASE", "release-a"); vi.stubEnv("DATABASE_URL", "file:" + path.join(dir, "test.db")); }
it("新鲜心跳不能掩盖 release、数据库或关键开关不匹配", () => {
  setup(); const now = Date.now(); recordWorkerPresence({ workerId: "worker", scan: true, now });
  expect(readWorkerPresence(now)).toMatchObject({ status: "RECENT", identityMatches: true, isActivelyInspecting: true });
  vi.stubEnv("PROJECTMEMO_RELEASE", "release-b");
  expect(readWorkerPresence(now)).toMatchObject({ status: "STALE", isProcessAlive: true, isActivelyInspecting: false, mismatchReason: "RELEASE_MISMATCH" });
  vi.stubEnv("PROJECTMEMO_RELEASE", "release-a"); vi.stubEnv("DATABASE_URL", "file:" + path.join(dir, "other.db"));
  expect(readWorkerPresence(now)).toMatchObject({ mismatchReason: "DATABASE_MISMATCH" });
  const asyncFlag = process.env.FOCUS_ASYNC_ENABLED;
  vi.stubEnv("DATABASE_URL", "file:" + path.join(dir, "test.db")); vi.stubEnv("FOCUS_ASYNC_ENABLED", "true");
  expect(readWorkerPresence(now)).toMatchObject({ mismatchReason: "CONFIG_MISMATCH" });
  vi.stubEnv("FOCUS_ASYNC_ENABLED", asyncFlag);
  for (const key of ["MISSION_INVESTIGATION_DELEGATION_ENABLED", "MISSION_AUTO_CONTINUATION_ENABLED", "REPO_CI_OBSERVER_ENABLED", "CALENDAR_EVENT_WRITE_ENABLED"]) {
    const original = process.env[key];
    vi.stubEnv(key, original === "true" ? "false" : "true");
    expect(readWorkerPresence(now)).toMatchObject({ mismatchReason: "CONFIG_MISMATCH", isActivelyInspecting: false });
    vi.stubEnv(key, original);
  }
});
it("已失去心跳或巡检失败时不能继续显示正在成功巡检", () => {
  setup(); const now = Date.now(); recordWorkerPresence({ workerId: "worker", scan: true, now });
  expect(readWorkerPresence(now + 61000)).toMatchObject({ status: "STALE", isActivelyInspecting: false });
  recordWorkerPresence({ workerId: "worker", failedScan: "MATERIAL", now: now + 1000 });
  expect(readWorkerPresence(now + 1000)).toMatchObject({ status: "RECENT", isActivelyInspecting: false, failedPhase: "MATERIAL" });
  // 一处持续失败不能被别的扫描成功掩盖：单纯 scan 成功不清理失败信号。
  recordWorkerPresence({ workerId: "worker", scan: true, now: now + 2000 });
  expect(readWorkerPresence(now + 2000)).toMatchObject({ status: "RECENT", failedPhase: "MATERIAL" });
  recordWorkerPresence({ workerId: "worker", scan: true, cleanCycle: true, now: now + 3000 });
  expect(readWorkerPresence(now + 3000)).toMatchObject({ isActivelyInspecting: true, failedPhase: null });
});

