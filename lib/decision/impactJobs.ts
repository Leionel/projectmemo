import { db } from "@/lib/db";
import { json } from "@/lib/mission/contracts";
import { writeTransaction } from "@/lib/copilot/confirmation";
import { event } from "@/lib/mission/repository";
import type { Tx } from "./snapshot";
import { readDecisionSnapshot } from "./snapshot";
import { assessImpact } from "./impact";
export async function enqueueImpact(
  tx: Tx,
  projectId: string,
  mutationReceiptId: string,
  roots: string[],
) {
  return tx.projectImpactJob.upsert({
    where: { projectId_mutationReceiptId: { projectId, mutationReceiptId } },
    create: {
      projectId,
      mutationReceiptId,
      rootsJson: json([...new Set(roots)]),
    },
    update: {},
  });
}
/** The existing Worker consumes bounded jobs. The transaction is the claim/fence: crashes roll back all effects. */
export async function consumeImpactJobs(limit = 5) {
  const ids = await db.projectImpactJob.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 10),
    select: { id: true },
  });
  for (const row of ids) {
    try {
      await writeTransaction(`impact:${row.id}`, async (tx) => {
        const claim = await tx.projectImpactJob.updateMany({
          where: { id: row.id, status: "PENDING" },
          data: { status: "PROCESSING", attempts: { increment: 1 } },
        });
        if (!claim.count) return;
        const job = await tx.projectImpactJob.findUniqueOrThrow({
          where: { id: row.id },
        });
        const owners = await tx.projectMembership.findMany({
          where: { projectId: job.projectId, role: "OWNER" },
          select: { userId: true },
        });
        let changed = 0;
        for (const owner of owners) {
          const s = await readDecisionSnapshot(tx, job.projectId, owner.userId),
            impact = assessImpact(s, job.rootsJson as string[]);
          for (const item of impact.items.filter(
            (i) => i.kind === "PLAN_STALE" && !i.historical,
          )) {
            const id = item.target.slice(8),
              m = s.missions.find((m) => m.id === id)!;
            if (m.createdAt >= job.createdAt) continue;
            if (
              await tx.projectImpactEffect.findUnique({
                where: { jobId_missionId: { jobId: job.id, missionId: id } },
              })
            )
              continue;
            await tx.projectImpactEffect.create({
              data: {
                jobId: job.id,
                missionId: id,
                oldPlanRevision: m.planRevision,
                newPlanRevision: m.planRevision + 1,
              },
            });
            await tx.agentMissionApproval.updateMany({
              where: { missionId: id, status: { in: ["PENDING", "APPROVED"] } },
              data: { status: "EXPIRED" },
            });
            await tx.agentMissionStep.updateMany({
              where: {
                missionId: id,
                status: { in: ["READY", "RUNNING", "WAITING_APPROVAL"] },
              },
              data: { status: "OBSOLETE" },
            });
            await tx.agentMission.update({
              where: { id },
              data: {
                planRevision: { increment: 1 },
                contextVersion: { increment: 1 },
                version: { increment: 1 },
                status:
                  m.status === "WAITING_INPUT" ? "WAITING_INPUT" : "PAUSED",
                planJson: json({
                  ...(m.planJson as object),
                  impactReassessment: {
                    jobId: job.id,
                    previousPlanRevision: m.planRevision,
                  },
                  resumeStatus:
                    m.status === "WAITING_INPUT" ? "WAITING_INPUT" : "READY",
                }),
                pauseReason: "REVIEW_REQUIRED",
                executionSlot: null,
                leaseOwner: null,
                leaseUntil: null,
                leaseEpoch: { increment: 1 },
                lastErrorJson: {
                  code: "SOURCE_CHANGED",
                  message: "项目依据发生变化，请复核受影响路径后继续原委托",
                  impactJobId: job.id,
                  rootIds: job.rootsJson,
                },
              },
            });
            await event(tx, id, "IMPACT_REASSESSMENT_REQUIRED", {
              jobId: job.id,
              rootIds: job.rootsJson,
              path: item.path,
              coverage: impact.coverage.state,
            });
            changed++;
          }
        }
        await tx.projectImpactJob.update({
          where: { id: job.id },
          data: {
            status: "DONE",
            lastError: null,
            resultJson: { changedMissions: changed },
          },
        });
      });
    } catch {
      await db.projectImpactJob.updateMany({
        where: { id: row.id, status: "PENDING" },
        data: {
          attempts: { increment: 1 },
          lastError: "影响分析暂未完成，将由原 Worker 重试",
          nextAttemptAt: new Date(Date.now() + 30000),
        },
      });
    }
  }
  return ids.length;
}
