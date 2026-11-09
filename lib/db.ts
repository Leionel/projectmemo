import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/lib/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

type SqliteConnection = { prepare: (sql: string) => unknown; pragma: (sql: string) => unknown };

/**
 * Web 与 Worker 两个进程共用一个库。适配器用延迟 BEGIN，先读后写的事务在争用时
 * 会跳过 busy_timeout 直接报 SQLITE_BUSY；开事务即取写锁后改为排队等待。
 */
function configureConnection(connection: SqliteConnection) {
  try {
    connection.pragma("journal_mode = WAL");
  } catch (error) {
    console.warn("SQLite WAL mode is unavailable", error);
  }
  const prepare = connection.prepare.bind(connection);
  connection.prepare = (sql) => prepare(sql === "BEGIN" ? "BEGIN IMMEDIATE" : sql);
}

function createClient() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
  });
  const connect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    const connected = await connect();
    configureConnection((connected as unknown as { client: SqliteConnection }).client);
    return connected;
  };
  return new PrismaClient({ adapter });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
