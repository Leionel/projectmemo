import { db } from "@/lib/db";
import type { MissionCompletionSummary } from "./presentation";

/** Caller must authorize the Mission first. This reads existing records only. */
export async function readMissionCompletion(missionId: string, draftVerification: string | null): Promise<MissionCompletionSummary> {
  const [criteria, adoptionCount, latestAdoption] = await Promise.all([
    db.agentMissionEvent.findFirst({ where: { missionId, type: "CRITERIA_CHECKED" }, orderBy: { seq: "desc" }, select: { createdAt: true, payloadJson: true } }),
    db.missionArtifactReceipt.count({ where: { missionId } }),
    db.missionArtifactReceipt.findFirst({ where: { missionId }, orderBy: { createdAt: "desc" }, select: { artifactId: true } }),
  ]);
  const payload = criteria?.payloadJson as { checks?: Array<{ passed?: boolean }> } | undefined;
  const checks = payload?.checks;
  return {
    criteriaPassed: checks?.length ? checks.every(check => check.passed === true) : null,
    criteriaCheckedAt: criteria?.createdAt.toISOString() ?? null,
    draftVerification,
    adoptionCount,
    latestArtifactId: latestAdoption?.artifactId ?? null,
    realityOutcome: "NOT_INFERRED",
  };
}
