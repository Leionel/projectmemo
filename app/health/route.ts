export const dynamic = "force-dynamic";

export async function GET() {
  const release = process.env.PROJECTMEMO_RELEASE?.trim().slice(0, 80) || "unversioned";
  return Response.json(
    {
      status: "ok",
      service: "projectmemo",
      schema_version: "2.1",
      release,
      capabilities: ["record_memory", "query_memory", "inspect_project", "create_action"],
      checked_at: new Date().toISOString(),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
