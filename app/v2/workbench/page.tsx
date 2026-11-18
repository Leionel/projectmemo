import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@/lib/config/features";
import { OutcomeWorkbench } from "@/components/v2/OutcomeWorkbench";
import { readRevision } from "@/lib/types/workbench";
export const dynamic = "force-dynamic";
export default async function WorkbenchPage({ searchParams }: { searchParams: Promise<{ missionId?: string; entry?: string; revision?: string; from?: string; questionId?: string }> }) {
  if (!isFeatureEnabled("MISSION_WORKBENCH_ENABLED", false)) notFound();
  const { missionId, entry, revision, from, questionId } = await searchParams;
  const initialQuestionId = entry === "question" && typeof questionId === "string" && questionId.length <= 160 ? questionId : undefined;
  return <OutcomeWorkbench key={JSON.stringify([missionId, entry, revision, from, initialQuestionId])} missionId={missionId}
    entry={entry === "question" || entry === "review" ? entry : undefined} initialQuestionId={initialQuestionId}
    initialRevision={readRevision(revision)} initialBaseline={readRevision(from)} />;
}
