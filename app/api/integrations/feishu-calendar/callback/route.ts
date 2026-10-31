import { NextResponse } from "next/server";
import { AppError } from "@/lib/api";
import { authenticateUser } from "@/lib/auth/guard";
import { completeCalendarConnection } from "@/lib/services/calendarConnectionService";

export const runtime = "nodejs";
export async function GET(request: Request) {
  const url = new URL(request.url), state = url.searchParams.get("state") ?? "", code = url.searchParams.get("code") ?? "", denied = url.searchParams.get("error");
  const redirect = (path: string) => NextResponse.redirect(new URL(path, url.origin), { headers: { "cache-control": "no-store" } });
  if (denied) return redirect("/projects?calendar=denied");
  if (!state || !code) return redirect("/projects?calendar=error&reason=state_or_code_missing");
  try {
    const { user } = await authenticateUser(request);
    const result = await completeCalendarConnection(user.id, state, code);
    return redirect(`/projects/${result.projectId}/records?calendar=connected`);
  } catch (error) {
    const reason = error instanceof AppError ? error.code.toLowerCase() : "calendar_error";
    return redirect(`/projects?calendar=error&reason=${encodeURIComponent(reason)}`);
  }
}
