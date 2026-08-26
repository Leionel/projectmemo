export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { status: "ok", service: "projectmemo", checked_at: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } },
  );
}
