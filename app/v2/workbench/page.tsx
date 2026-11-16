import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/config/features";
import { OutcomeWorkbench } from "@/components/v2/OutcomeWorkbench";
export const dynamic = "force-dynamic";
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ missionId?: string }> }) {
  if (!isFeatureEnabled("MISSION_WORKBENCH_ENABLED", false)) notFound();
  const { missionId } = await searchParams;
  return <OutcomeWorkbench key={missionId ?? "sample"} missionId={missionId} />;
}
