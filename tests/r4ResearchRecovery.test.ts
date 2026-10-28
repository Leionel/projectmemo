import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

describe("PR6 实际进程中断与原 turn 恢复（HTTP stub，0 付费）", () => {
  for (const mode of ["snapshot", "unknown"]) it(mode === "snapshot" ? "重启复用已完成网页检查点，不再次发送请求" : "发送意图后中断，重启保留未知且不重发", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-pr6-recovery-"));
    const run = (action: string) => spawnSync(process.execPath, ["--import", "tsx", "scripts/pr6-turn-recovery-probe.ts", action, dir], { cwd: process.cwd(), encoding: "utf8", timeout: 90000 });
    try {
      const crashed = run(mode); expect(crashed.status, crashed.stderr + crashed.stdout).toBe(mode === "snapshot" ? 74 : 75);
      const sql = new Database(path.join(dir, "test.sqlite")); sql.exec("UPDATE ConversationTurn SET createdAt=datetime('now','-2 hours')"); sql.close();
      const resumed = run("resume"); expect(resumed.status, resumed.stderr + resumed.stdout).toBe(0);
      const result = JSON.parse(resumed.stdout.trim().split(/\r?\n/).at(-1)!);
      expect(result.userMessages).toBe(1); expect(result.externalCalls).toBe(mode === "snapshot" ? 1 : 0);
      expect(result.status).toBe(mode === "snapshot" ? "ANSWERED" : "UNKNOWN");
      expect(result.assistantMessages).toBe(mode === "snapshot" ? 1 : 0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }, 180000);
});
