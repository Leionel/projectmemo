import { expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
test("双进程原执行链在途纠正（合成模型响应）：新 generation 实际消费纠正，旧结果不发布且费用保留", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-ct1-probe-")), script = path.resolve("scripts/continuity-turn-probe.ts");
  const run = (mode: string) => spawnSync(process.execPath, ["--import", "tsx", script, mode, dir], { encoding: "utf8", timeout: 35000 });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const setup = run("setup"); expect(setup.status, setup.stderr).toBe(0);
    child = spawn(process.execPath, ["--import", "tsx", script, "run", dir], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = ""; child.stderr?.on("data", value => { stderr += value; });
    const done = new Promise<number | null>(resolve => child!.on("exit", resolve));
    const deadline = Date.now() + 15000;
    while (!fs.existsSync(path.join(dir, "route-dispatched"))) {
      if (Date.now() > deadline) throw new Error("未到请求派发屏障：" + stderr);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const control = run("correct"); expect(control.status, control.stderr).toBe(0);
    expect(await done, stderr).toBe(0);
    const result = JSON.parse(fs.readFileSync(path.join(dir, "run-result.json"), "utf8"));
    expect(result.turn.status).toBe("ANSWERED"); expect(result.assistantCount).toBe(1);
    expect(result.turn.readManifestJson.coordination.generation).toBe(1);
    expect(Object.keys(result.turn.readManifestJson.modelResults).every(k => k.startsWith("g1:"))).toBe(true);
    expect(result.turn.callCount).toBe(result.calls);
    expect(result.turn.usageJson.some((u: { callId: string }) => u.callId === "g0:route")).toBe(true);
    const used = JSON.parse(fs.readFileSync(path.join(dir, "model-corrections.json"), "utf8"));
    expect(used.items[0]).toMatchObject({ userCorrection: "旧版不是本届要求，只作为历史背景", authority: "USER_INTERPRETATION" });
  } finally { if (child?.exitCode === null) child.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
}, 60000);
