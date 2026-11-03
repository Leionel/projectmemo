/**
 * Track C 证据隔离环境的共享常量（EV1/EV2）。
 *
 * 边界：
 * - 只用本工作树的隔离 SQLite `prisma/final-preparation.db`（与 tmp/final-preparation/
 *   Start-Track.ps1 一致），绝不读 `.env`、不写真实开发库或其他 worktree。
 * - 本文件不做任何运行时 import（不导入 lib/**），因此可以在设置 DATABASE_URL 之前静态导入。
 * - 账号/密码只属于本地隔离库，写入 evidence/final-c 的 fixture 身份 JSON 时已注明。
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** 固定隔离库：本 Track 专用，脚本拒绝其他路径。 */
export const isolatedDbPath = path.join(repoRoot, "prisma", "final-preparation.db");
export const isolatedDbUrl = `file:${isolatedDbPath.replaceAll("\\", "/")}`;
export const attachmentDir = path.join(repoRoot, "tmp", "final-preparation", "attachments");
export const workerPresenceFile = path.join(
  repoRoot,
  "tmp",
  "final-preparation",
  "worker-presence.json",
);
export const webPort = 34112;
export const webBaseUrl = `http://127.0.0.1:${webPort}`;

export const evidenceDir = path.join(repoRoot, "evidence", "final-c", "20261103");
export const identityPath = path.join(evidenceDir, "fixture-identity.json");
export const readbackAuditPath = path.join(evidenceDir, "fixture-readback-audit.json");

/** 隔离库里识别本 fixture 的唯一标记；清理只删带此标记的项目。 */
export const fixtureMarker = "SYNTHETIC_FINAL_C_FIXTURE_ONLY";

/**
 * 固定本地测试账号。仅存在于本地隔离库；密码是固定合成值，不是真实用户凭据。
 * 登录接口只校验 username + password；AccountSecurity 已标记邮箱已验证，避免邮件验证阻塞。
 */
export const account = {
  username: "final-c-reviewer",
  password: "final-c-local-only-2026",
  email: "final-c-reviewer@local.invalid",
  displayName: "C 证据评审身份（本地隔离库）",
} as const;

export const seedCommand = "npm.cmd exec -- tsx scripts/final-c/seed-web-fixture.ts";
export const inspectCommand = "npm.cmd exec -- tsx scripts/final-c/inspect-fixture.ts";

/**
 * 与 tmp/final-preparation/Start-Track.ps1 一致的最小环境。
 * 顺序要求：必须在 `await import("../lib/db")` 之前调用 applyIsolatedEnv()。
 */
export function isolatedEnv(): Record<string, string> {
  return {
    DATABASE_URL: isolatedDbUrl,
    ATTACHMENT_DIR: attachmentDir,
    LLM_MODE: "mock",
    FOCUS_AGENT_ENABLED: "true",
    FOCUS_AGENT_R4_ENABLED: "true",
    FOCUS_CONTINUITY_ENABLED: "true",
    FOCUS_ASYNC_ENABLED: "false",
    FOCUS_WEB_ENABLED: "true",
    MISSION_ENABLED: "true",
    MISSION_UI_ENABLED: "true",
    MISSION_WRITES_ENABLED: "true",
    MISSION_WEB_ENABLED: "false",
    MISSION_AUTO_CONTINUATION_ENABLED: "false",
    WORKER_PRESENCE_FILE: workerPresenceFile,
  };
}

export function applyIsolatedEnv(): Record<string, string> {
  const env = isolatedEnv();
  Object.assign(process.env, env);
  delete process.env.PROJECTMEMO_BUILD_SKIP_TYPECHECK;
  return env;
}

/** 记录运行前工作树状态，供证据复核；只调用 git 读命令。 */
export function gitFacts(): { headSha: string; shortSha: string; branch: string; dirty: boolean; dirtyPaths: string[] } {
  const run = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
    } catch {
      return "";
    }
  };
  const headSha = run(["rev-parse", "HEAD"]) || "UNKNOWN";
  const dirtyPaths = run(["status", "--porcelain"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    headSha,
    shortSha: headSha.slice(0, 7),
    branch: run(["branch", "--show-current"]) || "UNKNOWN",
    dirty: dirtyPaths.length > 0,
    dirtyPaths,
  };
}

/** 确保证据目录存在；所有脚本只写 evidence/final-c/20261103/。 */
export function ensureEvidenceDirs(): void {
  for (const dir of [
    evidenceDir,
    path.join(evidenceDir, "logs"),
    path.join(evidenceDir, "screenshots", "normal"),
    path.join(evidenceDir, "screenshots", "abnormal"),
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
