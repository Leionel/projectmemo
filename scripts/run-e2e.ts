import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { E2E_BASE_URL, E2E_ENV, E2E_PORT } from "./e2e-env";

const nextCli = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next");
const playwrightCli = path.resolve(process.cwd(), "node_modules", "@playwright", "test", "cli.js");
const environment = { ...process.env, ...E2E_ENV, FORCE_COLOR: "0", NEXT_TELEMETRY_DISABLED: "1" };

let server: ChildProcess | undefined;
let serverExited = false;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function runBuild() {
  console.log("\n[e2e] build isolated production server");
  const result = spawnSync(process.execPath, [nextCli, "build"], {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`E2E production build failed with exit code ${result.status ?? "unknown"}`);
}

function startServer() {
  server = spawn(process.execPath, [nextCli, "start", "--hostname", "127.0.0.1", "--port", String(E2E_PORT)], {
    cwd: process.cwd(),
    env: environment,
    stdio: "ignore",
  });
  server.once("exit", () => { serverExited = true; });
}

async function waitForServer() {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error("E2E 服务器在就绪前退出。");
    try {
      const response = await fetch(E2E_BASE_URL, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The server is still starting; retry below.
    }
    await sleep(300);
  }
  throw new Error("E2E 服务器在 120 秒内未就绪。");
}

function stopServer() {
  if (!server?.pid || serverExited) return;
  if (process.platform === "win32") {
    // Next may create worker children. This targets only the process tree created above.
    spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    server.kill("SIGTERM");
  }
  server.unref();
}

function terminateProcessTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

function runPlaywright() {
  return new Promise<number>((resolve, reject) => {
    const reportPath = path.resolve(process.cwd(), "test-results", "e2e-results.json");
    fs.rmSync(reportPath, { force: true });
    const runner = spawn(process.execPath, [playwrightCli, "test", ...process.argv.slice(2)], {
      cwd: process.cwd(),
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const timers: { reportPoll?: ReturnType<typeof setInterval>; hardTimeout?: ReturnType<typeof setTimeout> } = {};

    const finish = (status: number) => {
      if (settled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      if (timers.reportPoll) clearInterval(timers.reportPoll);
      if (timers.hardTimeout) clearTimeout(timers.hardTimeout);
      console.log(`[e2e] completed with ${status === 0 ? "passing" : "failing"} result.`);
      if (status !== 0) {
        // 之前只收集不打印：一旦 Playwright 在打印最终汇总前卡住（Windows 上偶尔会），
        // 失败用例名与断言就完全看不到，只能靠人工复现。这里把收集到的输出回放出来。
        console.error("[e2e] runner output tail:");
        console.error(stripAnsi(output).split("\n").slice(-40).join("\n"));
        console.error("[e2e] failure details: test-results/e2e-results.json");
      }
      resolve(status);
    };

    const scheduleWatchdog = () => {
      const plainOutput = stripAnsi(output);
      const failed = /\n\s*\d+ failed\s*\r?\n/.test(plainOutput);
      const completed = plainOutput.includes(" passed (") || failed;
      if (watchdog || !completed) return;
      watchdog = setTimeout(() => {
        // Playwright occasionally keeps a Node handle alive on Windows after it
        // has already printed its final summary. The reported summary remains
        // the source of truth; this only releases the verified-complete runner.
        console.log("[e2e] runner summary received; closing lingering test process.");
        terminateProcessTree(runner);
        finish(failed ? 1 : 0);
      }, 3_000);
    };

    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      scheduleWatchdog();
    };

    runner.stdout?.on("data", collect);
    runner.stderr?.on("data", collect);
    runner.once("error", reject);
    runner.once("exit", (code) => finish(code ?? 1));

    timers.reportPoll = setInterval(() => {
      try {
        const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as { stats?: { duration?: number; unexpected?: number; flaky?: number } };
        if (typeof report.stats?.duration !== "number") return;
        const failed = (report.stats.unexpected ?? 0) > 0 || (report.stats.flaky ?? 0) > 0;
        console.log("[e2e] structured result written; closing lingering test process.");
        terminateProcessTree(runner);
        finish(failed ? 1 : 0);
      } catch {
        // JSON reporter writes the report only after a test run has a final result.
      }
    }, 500);

    timers.hardTimeout = setTimeout(() => {
      console.error("[e2e] test runner exceeded its 210-second safety limit.");
      // 卡住时同样回放输出：失败用例通常已经打印在列表里，但汇总行还没出现
      console.error("[e2e] runner output tail:");
      console.error(stripAnsi(output).split("\n").slice(-40).join("\n"));
      terminateProcessTree(runner);
      finish(1);
    }, 210_000);
  });
}

async function main() {
  try {
    runBuild();
    startServer();
    await waitForServer();
    process.exitCode = await runPlaywright();
  } finally {
    stopServer();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  stopServer();
});
