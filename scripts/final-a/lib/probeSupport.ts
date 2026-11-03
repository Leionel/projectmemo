/**
 * A1 探针共享基建（只读/特征化，不修复产品代码）。
 *
 * 约定：
 * - 先调用 setupIsolatedDatabase()，它会设置 DATABASE_URL 等环境变量；
 * - 之后才允许动态 import "@/lib/db" 等模块（顶层静态 import 请勿引用 lib/）；
 * - 所有写入只发生在本次 mkdtemp 的临时 SQLite 文件里。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const EVIDENCE_DIR = "evidence/final-a/20261103";

export type IsolatedDatabase = {
  /** 临时目录（每次运行唯一） */
  dir: string;
  /** 临时 SQLite 文件绝对路径 */
  file: string;
  /** file: 协议 DATABASE_URL */
  databaseUrl: string;
  migrationsApplied: number;
  schemaTables: number;
};

/**
 * 独立测试库：不读取 .env、不依赖 prisma/final-preparation.db。
 * 复用 tests/helpers/continuityDatabase.ts 的做法：mkdtemp + better-sqlite3 按序重放
 * prisma/migrations/<name>/migration.sql + WAL，然后返回给调用方设置环境。
 */
export function setupIsolatedDatabase(label: string): IsolatedDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pm-final-a-${label}-`));
  const file = path.join(dir, "probe.db");
  const databaseUrl = "file:" + file.replaceAll("\\", "/");
  Object.assign(process.env, {
    DATABASE_URL: databaseUrl,
    // Mission 主流程开关（与 tests/helpers/continuityDatabase.ts 对齐）
    MISSION_ENABLED: "true",
    MISSION_WRITES_ENABLED: "true",
    MISSION_UI_ENABLED: "true",
    MISSION_EVENT_CONTINUATION_ENABLED: "true",
    MISSION_ARTIFACT_ADOPTION_ENABLED: "true",
    FOCUS_AGENT_ENABLED: "true",
    FOCUS_AGENT_R4_ENABLED: "false",
    FOCUS_CONTINUITY_ENABLED: "true",
    FOCUS_ASYNC_ENABLED: "false",
    FOCUS_WEB_ENABLED: "true",
    SEMANTIC_MEMORY_ENABLED: "false",
    // 不调用真实模型：探针只读服务/投影，不需要 provider
    LLM_MODE: "mock",
    // fs 边界：worker presence 写到临时目录，避免污染工作树内 .runtime/
    WORKER_PRESENCE_FILE: path.join(dir, "worker-presence.json"),
  });
  const sql = new Database(file);
  sql.pragma("journal_mode = WAL");
  const migrationsDir = path.join(repoRoot, "prisma/migrations");
  const names = fs.readdirSync(migrationsDir).sort();
  for (const name of names) {
    const migration = path.join(migrationsDir, name, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  const schemaTables = (
    sql.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'").get() as { n: number }
  ).n;
  sql.close();
  return { dir, file, databaseUrl, migrationsApplied: names.length, schemaTables };
}

/** 实际的 git HEAD；证据里的 baseSha 用它，而不是文档里的基线。 */
export function gitHead(): string {
  // 在 “git archive 基线快照” 里运行时没有 .git，用显式 pin 的 SHA。
  const pinned = process.env.PROBE_BASE_SHA?.trim();
  if (pinned) return pinned;
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "UNKNOWN";
  }
}

/** 本次探针实际读的源码树；默认当前工作树，基线快照运行时由环境变量说明。 */
export function probeSourceTree(): string {
  return process.env.PROBE_SOURCE_TREE?.trim() || "working-tree";
}

export function evidenceAbs(rel: string): string {
  // 默认写仓库 evidence/；A2 对照复跑时可用 PROBE_EVIDENCE_DIR 重定向，避免覆盖 BEFORE_FIX 证据。
  const override = process.env.PROBE_EVIDENCE_DIR?.trim();
  return override ? path.join(override, rel) : path.join(repoRoot, EVIDENCE_DIR, rel);
}

export function relFromRoot(abs: string): string {
  return path.relative(repoRoot, abs).replaceAll("\\", "/");
}

/** 写出证据 JSON（UTF-8、稳定缩进、末尾换行）。返回仓库相对路径（重定向时返回绝对路径）。 */
export function writeEvidence(rel: string, value: unknown): string {
  const abs = evidenceAbs(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(value, null, 2) + "\n", "utf8");
  return process.env.PROBE_EVIDENCE_DIR?.trim() ? abs : relFromRoot(abs);
}

export function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** 真实 JSON 序列化（Date -> ISO），用于证据样本，避免 Prisma 对象不可序列化。 */
export function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function shortHash(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.length > 16 ? `${value.slice(0, 16)}…` : value;
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 从错误对象提取探针关心的字段（AppError 的 code/status 等）。 */
export function errorFacts(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const extra = error as Error & { code?: string; status?: number };
  return {
    name: error.name,
    message: error.message,
    ...(extra.code ? { code: extra.code } : {}),
    ...(extra.status ? { status: extra.status } : {}),
  };
}

/**
 * 运行一个探针主体：成功写出证据并返回 0；失败也写证据（含错误），退出码非零。
 * exit code 0 = 探针跑完（不代表业务已修复）。
 */
export async function runProbe(
  name: string,
  outputRel: string,
  build: () => Promise<Record<string, unknown>>,
): Promise<number> {
  const startedAt = Date.now();
  try {
    const payload = await build();
    const final = {
      mode: "BEFORE_FIX" as const,
      probe: name,
      status: "PROBE_COMPLETED" as const,
      durationMs: Date.now() - startedAt,
      ...payload,
    };
    const written = writeEvidence(outputRel, final);
    console.log(`[probe] ${name} 完成，退出码 0；证据：${written}`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      writeEvidence(outputRel, {
        mode: "BEFORE_FIX" as const,
        probe: name,
        status: "SCRIPT_ERROR" as const,
        generatedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        error: {
          ...errorFacts(error),
          stack: error instanceof Error ? error.stack?.split("\n").slice(0, 12).join("\n") : undefined,
        },
      });
    } catch {
      /* 证据都写不了时只保留控制台输出 */
    }
    console.error(`[probe] ${name} 失败：${message}`);
    return 1;
  }
}
