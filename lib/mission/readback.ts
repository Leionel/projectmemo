import { z } from "zod";
import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import { artifactTypeLabels } from "@/lib/types";
import { ownedMission } from "./repository";
import { materialUseProjection } from "./materialUseProjection";
import { fitContextSummary, type assessEvidenceFit } from "./evidenceFitService";
export const readTargetSchema = z
  .object({
    questionId: z.string().min(1).optional(),
    approvalId: z.string().min(1).optional(),
    outputId: z.string().min(1).optional(),
    revision: z.coerce.number().int().positive().optional(),
    receiptId: z.string().min(1).optional(),
    sourceId: z.string().max(180).regex(/^(capture|attachment):.+/).optional(),
  })
  .strict();
export async function readMissionBack(
  userId: string,
  id: string,
  raw: unknown = {},
) {
  const input = readTargetSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const m = await ownedMission(userId, id, tx);
    const [question, approval, output, receipt, adoptions, origin, steps] =
      await Promise.all([
        input.questionId
          ? tx.agentMissionEvent.findFirst({
              where: { id: input.questionId, missionId: id, type: "QUESTION" },
            })
          : null,
        input.approvalId
          ? tx.agentMissionApproval.findFirst({
              where: { id: input.approvalId, missionId: id },
            })
          : null,
        input.outputId || input.revision
          ? tx.agentMissionOutput.findFirst({
              where: {
                missionId: id,
                ...(input.outputId ? { id: input.outputId } : {}),
                ...(input.revision ? { revision: input.revision } : {}),
              },
            })
          : null,
        input.receiptId
          ? tx.missionArtifactReceipt.findFirst({
              where: {
                id: input.receiptId,
                missionId: id,
                projectId: m.projectId,
              },
            })
          : null,
        tx.missionArtifactReceipt.findMany({
          where: { missionId: id, projectId: m.projectId },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: {
            artifact: { select: { createdAt: true, artifactType: true } },
          },
        }),
        tx.agentMissionEvent.findFirst({
          where: { missionId: id, type: "COPILOT_HANDOFF" },
          orderBy: { seq: "asc" },
        }),
        tx.agentMissionStep.findMany({
          where: { missionId: id, status: "SUCCEEDED" },
          orderBy: { ordinal: "desc" },
          take: 50,
          select: { resultJson: true },
        }),
      ]);
    if (
      (input.questionId && !question) ||
      (input.approvalId && !approval) ||
      (input.outputId && !output) ||
      (input.revision && !output) ||
      (input.receiptId && !receipt)
    )
      throw new AppError(
        "MISSION_TARGET_NOT_FOUND",
        "原问题、提案或成果版本已不可用，请查看当前委托；不会改为另一项结果",
        404,
      );
    if (
      receipt &&
      ((input.outputId && receipt.outputId !== input.outputId) ||
        (input.revision && receipt.outputRevision !== input.revision))
    )
      throw new AppError(
        "MISSION_TARGET_MISMATCH",
        "回执与指定草稿版本不一致，请从原成果重新进入",
        409,
      );
    const fitRows=await tx.agentMissionEvent.findMany({where:{missionId:id,type:"EVIDENCE_FIT_REVIEWED"},orderBy:{seq:"desc"},take:21});
    const selectedQuestionId=input.questionId??(m.waitStateJson as {questionId?:string}|null)?.questionId;
    const evidenceReviews={items:fitRows.slice(0,20).filter(e=>(e.payloadJson as {evidenceFit?:{premise?:{questionId?:string}}}).evidenceFit?.premise?.questionId===selectedQuestionId).slice(0,3).map(e=>({eventId:e.id,observedAt:e.createdAt.toISOString(),...fitContextSummary(e.payloadJson as unknown as NonNullable<Awaited<ReturnType<typeof assessEvidenceFit>>>)!})),truncated:fitRows.length>20};
    const actionIds = steps
      .map(
        (s) =>
          (s.resultJson as { data?: { actionId?: string } } | null)?.data
            ?.actionId,
      )
      .filter((x): x is string => !!x)
      .slice(0, 5);
    const actions = actionIds.length
      ? await tx.actionItem.findMany({
          where: { id: { in: actionIds }, projectId: m.projectId },
          select: {
            id: true,
            title: true,
            status: true,
            resultCardId: true,
            completedAt: true,
            isSimulated: true,
          },
        })
      : [];
    const sourceRunId = (origin?.payloadJson as { sourceRunId?: string } | null)
      ?.sourceRunId;
    const wait = m.waitStateJson as { questionId?: string } | null;
    const materialUses = await materialUseProjection(tx, {
      missionId: id, projectId: m.projectId,
      questionId: input.questionId ?? wait?.questionId ?? null, sourceId: input.sourceId,
    });
    return {
      schemaVersion: 1 as const,
      missionId: id,
      projectId: m.projectId,
      missionVersion: m.version,
      missionStatus: m.status,
      observedAt: new Date().toISOString(),
      missionUpdatedAt: m.updatedAt.toISOString(),
      materialUses,
      evidenceReviews,
      sourceConversation: sourceRunId
        ? {
            sourceRunId,
            href: `/projects/${encodeURIComponent(m.projectId)}/knowledge?openCopilot=1#copilot-run-${encodeURIComponent(sourceRunId)}`,
          }
        : null,
      selected: {
        question: question
          ? {
              id: question.id,
              text:
                (question.payloadJson as { question?: string }).question ??
                "原问题",
              historical:
                m.status !== "WAITING_INPUT" ||
                question.seq !==
                  (
                    await tx.agentMissionEvent.findFirst({
                      where: { missionId: id, type: "QUESTION" },
                      orderBy: { seq: "desc" },
                      select: { seq: true },
                    })
                  )?.seq,
            }
          : null,
        approval: approval
          ? {
              id: approval.id,
              status: approval.status,
              proposal: approval.proposalJson,
              expiresAt: approval.expiresAt.toISOString(),
            }
          : null,
        output,
        receipt: receipt
          ? {
              id: receipt.id,
              outputId: receipt.outputId,
              outputRevision: receipt.outputRevision,
              artifactId: receipt.artifactId,
            }
          : null,
      },
      adoptions: adoptions.map((r) => ({
        receiptId: r.id,
        outputId: r.outputId,
        outputRevision: r.outputRevision,
        artifactId: r.artifactId,
        artifactType: r.artifactType,
        artifactCreatedAt: r.artifact.createdAt.toISOString(),
        title: artifactTypeLabels[r.artifact.artifactType],
      })),
      actionReceipts: actions.map((a) => ({
        ...a,
        completedAt: a.completedAt?.toISOString() ?? null,
      })),
      realityOutcome: "NOT_INFERRED" as const,
    };
  });
}
export type MissionReadback = Awaited<ReturnType<typeof readMissionBack>>;
