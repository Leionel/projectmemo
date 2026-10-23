import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bash = process.platform === "win32" ? path.join(process.env.ProgramFiles ?? "C:/Program Files", "Git/bin/bash.exe") : "/bin/bash";
const script = fs.readFileSync("deploy/alibaba-cloud-linux/safe-update.sh", "utf8");
const functions = script.slice(script.indexOf("as_app()"), script.indexOf("trap 'on_error"));
const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe("ECS update script controlled rollback (no ECS, sudo, git, database or service operations)", () => {
  it("both scripts pass bash syntax and build precedes migration, health precedes Worker", () => {
    for (const file of ["safe-update.sh", "verify-p0a.sh"]) {
      expect(spawnSync(bash, ["-n", `deploy/alibaba-cloud-linux/${file}`], { encoding: "utf8" }).status).toBe(0);
    }
    expect(script.indexOf('npm run build -- --webpack')).toBeLessThan(script.indexOf('npm exec prisma -- migrate deploy'));
    expect(script.lastIndexOf('health "$TARGET"')).toBeLessThan(script.lastIndexOf('systemctl start projectmemo-mission-worker'));
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
