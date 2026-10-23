import { requestAccountMail } from "@/lib/auth/requestAccountMail";
export const runtime = "nodejs";
export function POST(request: Request) { return requestAccountMail(request, "VERIFY_EMAIL"); }
