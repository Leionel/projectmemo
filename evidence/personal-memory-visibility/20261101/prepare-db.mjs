/**
 * 可见性验收的数据库准备：独立临时库 + 全量迁移 + 两个合成账号。
 * 输出 DATABASE_URL 供 acceptance.mjs 与 next start 使用。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-visibility-db-"));
const file = path.join(dir, "visible.db");
const DATABASE_URL = "file:" + file.split(path.sep).join("/");
const env = { ...process.env, DATABASE_URL };

const migrate = spawnSync("npx.cmd", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
  { env, encoding: "utf8", shell: true });
if (migrate.status !== 0) {
  console.error("migrate failed", migrate.stdout, migrate.stderr);
  process.exit(1);
}

fs.writeFileSync(path.join(import.meta.dirname, "_seed.mts"), [
  'import { hashPassword } from "../../../lib/auth/password";',
  'import { db } from "../../../lib/db";',
  'const hash = await hashPassword("fixture-password-123");',
  'const a = await db.user.create({ data: { username: "vis-a", displayName: "可见性甲", passwordHash: hash } });',
  'await db.project.create({ data: { title: "合成项目", description: "d", goal: "核对可见性", scenario: "RESEARCH", memberships: { create: { userId: a.id, role: "OWNER" } } } });',
  'await db.user.create({ data: { username: "vis-b", displayName: "可见性乙", passwordHash: hash } });',
  'console.log("SEED_OK");',
  'await db.$disconnect();',
].join(String.fromCharCode(10)), "utf8");
const seed = spawnSync("npx.cmd", ["tsx", path.join(import.meta.dirname, "_seed.mts")], { env, encoding: "utf8", shell: true });
fs.rmSync(path.join(import.meta.dirname, "_seed.mts"), { force: true });
if (seed.status !== 0) {
  console.error("seed failed", seed.stdout, seed.stderr);
  process.exit(1);
}
console.log(DATABASE_URL);
console.log(dir);
