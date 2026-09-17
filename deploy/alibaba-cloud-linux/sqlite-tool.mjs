#!/usr/bin/env node
/**
 * SQLite 在线备份与校验助手。
 *
 * 为什么不直接 `cp projectmemo.db`：库处于 WAL 模式，已提交的事务可能还只在
 * -wal 文件里，直接复制 .db 会得到一个缺事务甚至损坏的快照。这里用
 * better-sqlite3 的 backup()（SQLite Online Backup API），在库仍被写入的情况下
 * 也能取到一致快照，并在落盘后立刻做完整性校验。
 *
 * 用法：
 *   node sqlite-tool.mjs backup <源库> <目标文件>
 *   node sqlite-tool.mjs verify <库文件>
 *   node sqlite-tool.mjs info   <库文件>
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

function fail(message) {
  process.stderr.write(`sqlite-tool: ${message}\n`);
  process.exit(1);
}

/**
 * better-sqlite3 是应用自己的依赖，直接从应用目录解析，
 * 这样运维机不需要额外安装 sqlite3 命令行工具。
 */
function loadBetterSqlite3(appDir) {
  const candidates = [process.cwd(), appDir, "/opt/projectmemo/app"].filter(Boolean);
  for (const base of candidates) {
    try {
      const require = createRequire(resolve(base, "noop.js"));
      return require("better-sqlite3");
    } catch {
      // 换下一个候选目录
    }
  }
  fail("找不到 better-sqlite3；请用 APP_DIR 指向应用目录，或在应用目录下执行本脚本");
}

const [, , command, ...args] = process.argv;
const appDir = process.env.APP_DIR;
const Database = loadBetterSqlite3(appDir);

if (command === "backup") {
  const [source, destination] = args;
  if (!source || !destination) fail("用法：backup <源库> <目标文件>");
  if (!existsSync(source)) fail(`源库不存在：${source}`);

  mkdirSync(dirname(resolve(destination)), { recursive: true });

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }

  const check = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const result = check.pragma("integrity_check", { simple: true });
    if (result !== "ok") fail(`备份完整性校验失败：${result}`);
    const tables = check
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table'")
      .get().n;
    process.stdout.write(`sqlite-tool: 备份完成并通过 integrity_check，表数量 ${tables}\n`);
  } finally {
    check.close();
  }
} else if (command === "verify") {
  const [file] = args;
  if (!file) fail("用法：verify <库文件>");
  if (!existsSync(file)) fail(`库文件不存在：${file}`);

  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const result = db.pragma("integrity_check", { simple: true });
    if (result !== "ok") fail(`完整性校验失败：${result}`);
    process.stdout.write("ok\n");
  } finally {
    db.close();
  }
} else if (command === "info") {
  const [file] = args;
  if (!file) fail("用法：info <库文件>");
  if (!existsSync(file)) fail(`库文件不存在：${file}`);

  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const count = (table) => {
      try {
        return db.prepare(`SELECT count(*) AS n FROM "${table}"`).get().n;
      } catch {
        return null;
      }
    };
    process.stdout.write(
      JSON.stringify({
        project: count("Project"),
        user: count("User"),
        capture: count("Capture"),
        knowledgeCard: count("KnowledgeCard"),
        attachment: count("Attachment"),
        agentRun: count("AgentRun"),
      }) + "\n",
    );
  } finally {
    db.close();
  }
} else {
  fail("用法：sqlite-tool.mjs <backup|verify|info> ...");
}