import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Database from "better-sqlite3";
const script = path.resolve("scripts/continuity-turn-probe.ts");
test("two OS directive writers with distinct commands and the same expected sequence have one winner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct1-probe-"));
  try {
    const setup = spawnSync(process.execPath, ["--import", "tsx", script, "setup", dir], { encoding: "utf8", timeout: 30000 }); expect(setup.status, setup.stderr).toBe(0);
    const run = (mode: string) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", script, mode, dir], { stdio: ["ignore", "pipe", "pipe"] });
      let error = ""; child.stderr.on("data", data => { error += data; }); child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(error)));
    });
    await Promise.all([run("revise-a"), run("revise-b")]);
    const results = ["revise-a", "revise-b"].map(mode => JSON.parse(fs.readFileSync(path.join(dir, mode + "-result.json"), "utf8")));
    expect(results.filter(r => r.status === "APPLIED")).toHaveLength(1);
    expect(results.find(r => r.status === "REJECTED")?.code).toBe("DIRECTIVE_CHANGED");
    const sql = new Database(path.join(dir, "test.sqlite"), { readonly: true });
    try { expect(sql.prepare("SELECT count(*) AS n FROM AgentDirectiveEvent").get()).toEqual({ n: 1 }); expect(sql.prepare("SELECT version FROM Conversation").get()).toEqual({ version: 2 }); }
    finally { sql.close(); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 30000);
test.each(["revise", "takeover"])("real OS worker competition: %s during dispatched model", async mode => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct1-probe-"));
  const run = (action: string) => spawnSync(process.execPath, ["--import", "tsx", script, action, dir], { encoding: "utf8", timeout: 35000 });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const setup = run("setup"); expect(setup.status, setup.stderr).toBe(0);
    child = spawn(process.execPath, ["--import", "tsx", script, "run", dir], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr?.on("data", data => { stderr += data; });
    const done = new Promise<number | null>(resolve => child!.on("exit", resolve));
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(path.join(dir, "route-dispatched"))) { if (Date.now() > deadline) throw new Error("No model dispatch barrier: " + stderr); await new Promise(r => setTimeout(r, 25)); }
    const competitor = run(mode); expect(competitor.status, competitor.stderr).toBe(0);
    expect(await done, stderr).toBe(0);
    const result = JSON.parse(fs.readFileSync(path.join(dir, mode === "revise" ? "run-result.json" : "takeover-result.json"), "utf8"));
    if (mode === "revise") {
      expect(result.turn.status).toBe("ANSWERED"); expect(result.assistantCount).toBe(1);
      const manifest = result.turn.readManifestJson;
      expect(manifest.coordination.generation).toBe(1);
      expect(manifest.experience.steps.filter((s: { status: string }) => s.status === "SUCCEEDED")).toHaveLength(2);
      expect(manifest.experience.goalGaps[0].workingObjective).toContain("稳演示");
      expect(Object.keys(manifest.modelResults).every(k => k.startsWith("g1:"))).toBe(true);
      expect(result.turn.callCount).toBe(result.calls); expect(result.calls).toBeGreaterThanOrEqual(7);
      expect(result.turn.usageJson.some((u: { callId: string }) => u.callId === "g0:route")).toBe(true);
    } else {
      expect(result.calls).toBe(0); expect(result.assistantCount).toBe(0); expect(result.turn.status).toBe("UNKNOWN");
      const old = JSON.parse(fs.readFileSync(path.join(dir, "run-result.json"), "utf8"));
      expect(old.assistantCount).toBe(0); expect(old.turn.usageJson).toHaveLength(0);
      expect(old.turn.reservationJson[0].state).toBe("RESERVED");
    }
  } finally { if (child?.exitCode === null) child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 60000);
