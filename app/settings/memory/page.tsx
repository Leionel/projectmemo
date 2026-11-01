import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/serverSession";
import { PersonalMemoryManager } from "@/components/PersonalMemoryManager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PersonalMemoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Fsettings%2Fmemory");
  return <PersonalMemoryManager displayName={user.displayName} />;
}
