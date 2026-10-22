import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/serverSession";
import { GlobalWorkspacePage } from "@/components/GlobalWorkspacePage";
import type { WorkspaceFilters } from "@/lib/server/globalWorkspace";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export default async function MemoryPage({ searchParams }: { searchParams: Promise<WorkspaceFilters> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?from=%2Fmemory");
  return <GlobalWorkspacePage userId={user.id} mode="memory" input={await searchParams} />;
}
