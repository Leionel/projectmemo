import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const rawUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
if (!rawUrl.startsWith("file:")) throw new Error("ProjectMemo db:setup currently expects a file: SQLite URL");

const filePath = path.resolve(rawUrl.slice("file:".length));
fs.mkdirSync(path.dirname(filePath), { recursive: true });
if (!fs.existsSync(filePath)) {
  const database = new Database(filePath);
  database.close();
  console.log(`Created SQLite database: ${filePath}`);
}
