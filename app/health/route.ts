import fs from "node:fs";
import { db } from "@/lib/db";
import { getAttachmentStorageDir } from "@/lib/storage/attachmentStorage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function passes(check: () => Promise<unknown>) {
  try {
    await check();
    return true;
  } catch (error) {
    console.error("Health check failed", error);
    return false;
  }
}

export async function GET() {
  const release = process.env.PROJECTMEMO_RELEASE?.trim().slice(0, 80) || "unversioned";
  const [database, storage] = await Promise.all([
    passes(() => db.$queryRaw`SELECT 1`),
    passes(() => fs.promises.access(getAttachmentStorageDir(), fs.constants.W_OK)),
  ]);
  const healthy = database && storage;
  return Response.json(
    {
      status: healthy ? "ok" : "degraded",
      service: "projectmemo",
      schema_version: "2.1",
      release,
      checks: { database: database ? "ok" : "failed", storage: storage ? "ok" : "failed" },
      capabilities: ["record_memory", "query_memory", "inspect_project", "create_action"],
      workflow_helpers: ["begin_request"],
      checked_at: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
