import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/serverSession";
import { PersonalMemoryManager } from "@/components/PersonalMemoryManager";
import { SettingsNav } from "@/components/SettingsNav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PersonalMemoryPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Fsettings%2Fmemory");
  return <div className="shell flex flex-col gap-2 pt-8 md:flex-row md:gap-6">
    <SettingsNav current="/settings/memory"/>
    <div className="min-w-0 flex-1"><PersonalMemoryManager displayName={user.displayName} /></div>
  </div>;
}
