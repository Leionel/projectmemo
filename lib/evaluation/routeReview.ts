import { db } from "@/lib/db";
import { sourceUse } from "@/lib/continuity/sourcePolicy";
import { record } from "@/lib/conversation/repository";
import type { Source } from "@/lib/mission/contracts";
import { ownedMission } from "@/lib/mission/repository";
import { readMissionWorkbench } from "@/lib/mission/workbenchService";
import type { CaseRun } from "./checks";
import type { FixtureRefs } from "./fixtures";

// The route harness materializes synthetic projects. Review evidence must come from the
// actual case execution, never the frozen answers or the model's claimed checks.
export async function readRouteReviewEvidence(refs: FixtureRefs, run: CaseRun) {
  const missionId = run.missionRealId;
  if (!refs.actorCanAccessProject || !refs.projectId || !missionId) {
    return { status: "NO_AUTHORIZED_MISSION", reportRevisionsSaved: 0 };
  }
  const userId = refs.ownerUserId;
  const [view, readback] = await Promise.all([
    readMissionWorkbench(userId, missionId),
    db.$transaction(async tx => {
      const mission = await ownedMission(userId, missionId, tx);
      const reads = await tx.agentMissionStep.findMany({
        where: { missionId, status: "SUCCEEDED", toolName: { in: ["read_project_material", "inspect_project", "read_repository_ci", "read_ci_jobs"] } },
        orderBy: { ordinal: "asc" },
        select: { id: true, toolName: true, finishedAt: true, resultJson: true },
      });
      const receipts: Array<{ stepId: string; tool: string; finishedAt: Date | null; sources: Array<Pick<Source, "id" | "revision" | "hash" | "observedAt" | "text">> }> = [];
      for (const read of reads) {
        const attached = record(read.resultJson).sources;
        const sources = Array.isArray(attached) ? attached as Source[] : [];
        const visible = await Promise.all(sources.map(async source =>
          (await sourceUse(userId, mission.projectId, source.id, tx, { missionId })).state === "ALLOWED"
            ? { id: source.id, revision: source.revision, hash: source.hash, observedAt: source.observedAt, text: source.text.slice(0, 2000) }
            : null));
        receipts.push({ stepId: read.id, tool: read.toolName, finishedAt: read.finishedAt,
          sources: visible.filter(source => source !== null) });
      }
      return receipts;
    }),
  ]);
  const reportRevisionsSaved = run.outputsAfter - run.outputsBefore;
  return {
    status: reportRevisionsSaved > 0 || view.stageArtifacts.length ? "REVIEWABLE_DELIVERABLE" : "NO_NEW_DELIVERABLE",
    missionId, phase: view.phase, reportRevisionsSaved,
    reportRevisions: view.outputs.map(({ id, revision, createdAt, sourceKeys, blocks, missingInformation, sourceAccessChanged }) =>
      ({ id, revision, createdAt, sourceKeys, blocks, missingInformation, sourceAccessChanged })),
    stageArtifacts: view.stageArtifacts.map(({ id, skillId, label, createdAt, sourceKeys, blocks, unknowns, checks }) =>
      ({ id, skillId, label, createdAt, sourceKeys, blocks, unknowns, checks })),
    sources: view.sources,
    readback,
    events: view.events,
    evidencePack: run.evidence.pack,
  };
}
