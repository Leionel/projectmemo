import { accountMailConfiguration } from "@/lib/auth/mail";
export const runtime = "nodejs";
export function GET() {
  const emailReady = Boolean(accountMailConfiguration());
  return Response.json({ registrationEnabled: emailReady, passwordResetEnabled: emailReady }, { headers: { "cache-control": "no-store" } });
}
