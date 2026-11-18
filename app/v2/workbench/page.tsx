import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/config/features";
import { OutcomeWorkbench } from "@/components/v2/OutcomeWorkbench";
import { readRevision } from "@/lib/types/workbench";
export const dynamic = "force-dynamic";
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ missionId?: string; entry?: string; revision?: string; from?: string }> }) {
  if (!isFeatureEnabled("MISSION_WORKBENCH_ENABLED", false)) notFound();
  const { missionId, entry, revision, from } = await searchParams;
  return <OutcomeWorkbench key={JSON.stringify([missionId, entry, revision, from])} missionId={missionId}
    entry={entry === "question" || entry === "review" ? entry : undefined} initialRevision={readRevision(revision)} initialBaseline={readRevision(from)} />;
}
