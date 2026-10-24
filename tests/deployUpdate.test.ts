import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "/bin/bash";
const script = fs.readFileSync("deploy/alibaba-cloud-linux/safe-update.sh", "utf8");
const functions = script.slice(script.indexOf("as_app()"), script.indexOf("trap 'on_error"));
const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  delete process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK;
});

describe("ECS update script controlled rollback (no ECS, sudo, git, database or service operations)", () => {
  it("both scripts pass bash syntax and build precedes migration, health precedes Worker", () => {
    for (const file of ["safe-update.sh", "verify-p0a.sh"]) {
      expect(spawnSync(bash, ["-n", `deploy/alibaba-cloud-linux/${file}`], { encoding: "utf8" }).status).toBe(0);
    }
    expect(script.indexOf('npm run build -- --webpack')).toBeLessThan(script.indexOf('npm exec prisma -- migrate deploy'));
    expect(script.lastIndexOf('health "$TARGET"')).toBeLessThan(script.lastIndexOf('systemctl start projectmemo-mission-worker'));
    expect(script.indexOf('check_build_memory /proc/meminfo')).toBeLessThan(script.indexOf('STOPPED=1'));
    expect(script).toContain('NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP_MB"');
  });
  it("type check runs standalone before the build and only the build skips in-build checking", () => {
    const typegen = script.indexOf('npm exec next -- typegen');
    const tsc = script.indexOf('npm exec tsc -- --noEmit');
    const build = script.indexOf('npm run build -- --webpack');
    expect(typegen).toBeGreaterThan(script.indexOf('npm exec prisma -- generate'));
    expect(tsc).toBeGreaterThan(typegen);
    expect(tsc).toBeLessThan(build);
    expect(script).toContain('NODE_OPTIONS="--max-old-space-size=$BUILD_HEAP_MB" npm exec tsc -- --noEmit');
    expect(script.indexOf('PROJECTMEMO_BUILD_SKIP_TYPECHECK=1')).toBeGreaterThan(tsc);
    expect(script).toContain('CIRCLE_NODE_TOTAL=1');
    expect(script).not.toContain('CIRCLE_NODE_TOTAL=2');
    expect(script).toContain('size_build_memory /proc/meminfo');
    expect(script.indexOf('size_build_memory /proc/meminfo')).toBeGreaterThan(script.indexOf('STOPPED=1'));
  });
  it("next build keeps type checking unless the deploy opt-in is set", async () => {
    delete process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK;
    vi.resetModules();
    expect((await import("../next.config")).default.typescript).toBeUndefined();
    process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK = "1";
    vi.resetModules();
    expect((await import("../next.config")).default.typescript).toEqual({ ignoreBuildErrors: true });
    delete process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK;
  });
  it.each([
    { heap: "", ram: 4 * 1024, swap: 0, status: 0 },
    { heap: "2048", ram: 1536, swap: 2048, status: 0 },
    { heap: "2048", ram: 2048, swap: 0, status: 1 },
    { heap: "1023", ram: 4096, swap: 0, status: 1 },
    { heap: "2048;echo unsafe", ram: 4096, swap: 0, status: 1 },
  ])("checks heap and memory headroom before stopping services: $heap / $ram / $swap", ({ heap, ram, swap, status }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-deploy-memory-")); temporary.push(directory);
    const info = path.join(directory, "meminfo");
    fs.writeFileSync(info, `MemAvailable: ${ram * 1024} kB\nSwapFree: ${swap * 1024} kB\n`);
    const run = spawnSync(bash, ["--noprofile", "--norc", "-c", `${functions}\ncheck_build_memory "$MEMORY_INFO"`], {
      encoding: "utf8", env: { ...process.env, PROJECTMEMO_BUILD_HEAP_MB: heap, MEMORY_INFO: info.replaceAll("\\", "/") },
    });
    expect(run.status, run.stderr).toBe(status);
    expect(run.stdout).not.toContain("\nunsafe");
  });
  it.each([
    { ram: 3072, swap: 0, heap: "1536" },
    { ram: 1800, swap: 0, heap: "1416" },
    { ram: 1300, swap: 4096, heap: "1280" },
    { ram: 1300, swap: 1024, heap: "" },
  ])("sizes the heap from post-stop memory before building: avail=$ram swapfree=$swap -> $heap", ({ ram, swap, heap }) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-deploy-size-")); temporary.push(directory);
    const info = path.join(directory, "meminfo");
    fs.writeFileSync(info, `MemAvailable: ${ram * 1024} kB\nSwapFree: ${swap * 1024} kB\n`);
    const run = spawnSync(bash, ["--noprofile", "--norc", "-c", `${functions}
BUILD_HEAP_MB=1536
size_build_memory "$MEMORY_INFO" && printf 'heap=%s\\n' "$BUILD_HEAP_MB"`], {
      encoding: "utf8", env: { ...process.env, MEMORY_INFO: info.replaceAll("\\", "/") },
    });
    if (heap === "") {
      expect(run.status, run.stderr).toBe(1);
      return;
    }
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trimEnd().endsWith(`heap=${heap}`)).toBe(true);
  });
  it.each([0, 1])("failure trap restores only after services were stopped: STOPPED=%d", stopped => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pm-deploy-fault-")); temporary.push(directory);
    const app = path.join(directory, "app"), backup = path.join(directory, "backup"), environment = path.join(directory, "environment");
    for (const name of ["node_modules", "lib/generated/prisma", ".next"]) { fs.mkdirSync(path.join(app, name), { recursive: true }); fs.writeFileSync(path.join(app, name, "marker"), "new"); }
    for (const name of ["previous-node_modules", "previous-prisma-client", "previous-next-build"]) { fs.mkdirSync(path.join(backup, name), { recursive: true }); fs.writeFileSync(path.join(backup, name, "marker"), "old"); }
    fs.writeFileSync(environment, "new-env"); fs.writeFileSync(path.join(backup, "projectmemo.env"), "old-env");
    fs.writeFileSync(path.join(directory, "business.db"), "preserve-new-writes");
    const run = spawnSync(bash, ["--noprofile", "--norc", "-c", `${functions}
as_app() { return 0; }
systemctl() { return 0; }
journalctl() { return 0; }
health() { return 0; }
on_error 45
`], { encoding: "utf8", env: { ...process.env, APP: app.replaceAll("\\", "/"), BACKUP: backup.replaceAll("\\", "/"), ENV_FILE: environment.replaceAll("\\", "/"),
        PREVIOUS: "old-commit", PREVIOUS_HEALTH: "old-release", STOPPED: String(stopped), DEPS_MOVED: "1", GENERATED_MOVED: "1", BUILD_SWITCHED: "1" } });
    expect(run.status, run.stderr).toBe(1);
    for (const name of ["node_modules", "lib/generated/prisma", ".next"]) expect(fs.readFileSync(path.join(app, name, "marker"), "utf8")).toBe(stopped ? "old" : "new");
    expect(fs.readFileSync(environment, "utf8")).toBe(stopped ? "old-env" : "new-env");
    expect(fs.readFileSync(path.join(directory, "business.db"), "utf8")).toBe("preserve-new-writes");
  });
});
