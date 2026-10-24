import { db } from "@/lib/db";
import { AppError } from "@/lib/api";
import type { Prisma } from "@/lib/generated/prisma/client";
import { jsonHash } from "@/lib/mission/contracts";
import {
  evaluateTemporalCard,
  isTemporalRelationActive,
} from "@/lib/memory/temporalLedger";
import type { TemporalRelationData } from "@/lib/types";
const omit = (value: object, keys: string[]) =>
  Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key)),
  );
export const IMPACT_RULE = "impact-v1";
export type Tx = Prisma.TransactionClient;
export async function readDecisionSnapshot(
  tx: Tx,
  projectId: string,
  ownerUserId?: string,
  now = new Date(),
) {
  const limit = 200;
  const project = await tx.project.findUnique({
    where: { id: projectId },
    select: { id: true, title: true, goal: true, deadline: true },
  });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "项目不存在", 404);
  const [
    cards,
    relations,
    actions,
    requirements,
    deliverables,
    artifacts,
    missions,
    captures,
    attachments,
  ] = await Promise.all([
    tx.knowledgeCard.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        summary: true,
        type: true,
        captureId: true,
        attachmentId: true,
        createdAt: true,
        capture: { select: { rawText: true } },
        attachment: {
          select: {
            extractionStatus: true,
            sha256: true,
            extractedText: true,
            revisions: {
              orderBy: { revisionIndex: "desc" },
              take: 1,
              select: {
                id: true,
                revisionIndex: true,
                text: true,
                source: true,
              },
            },
          },
        },
      },
    }),
    tx.cardRelation.findMany({
      where: { currentCard: { projectId }, relatedCard: { projectId } },
      orderBy: { id: "asc" },
      take: 1001,
      include: {
        currentCard: {
          select: { id: true, title: true, summary: true, createdAt: true },
        },
        relatedCard: {
          select: { id: true, title: true, summary: true, createdAt: true },
        },
      },
    }),
    tx.actionItem.findMany({
      where: { projectId, isSimulated: false },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        description: true,
        status: true,
        priority: true,
        dueAt: true,
        estimatedMinutes: true,
        dependencyVersion: true,
        resultCardId: true,
        sourceCardId: true,
      },
    }),
    tx.actionRequirement.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      take: 1001,
    }),
    tx.deliverable.findMany({
      where: { milestone: { projectId } },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        title: true,
        status: true,
        expectedEvidence: true,
        evidences: { orderBy: { id: "asc" }, take: 201 },
      },
    }),
    tx.generatedArtifact.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        artifactType: true,
        content: true,
        claims: true,
        sourceRefs: true,
        missionReceipt: { select: { missionId: true, blockMapJson: true } },
      },
    }),
    ownerUserId
      ? tx.agentMission.findMany({
          where: { projectId, ownerUserId },
          orderBy: { id: "asc" },
          take: limit + 1,
          select: {
            id: true,
            goal: true,
            planRevision: true,
            contextVersion: true,
            constraintsVersion: true,
            researchScopeVersion: true,
            successCriteriaJson: true,
            constraintsJson: true,
            researchScopeJson: true,
            budgetJson: true,
            budgetUsedJson: true,
            status: true,
            updatedAt: true,
            createdAt: true,
            planJson: true,
            externalSources: {
              orderBy: { id: "asc" },
              take: 201,
              select: {
                id: true,
                normalizedContentHash: true,
                availability: true,
                retrievalMode: true,
                resolvedUrl: true,
              },
            },
            steps: {
              orderBy: { ordinal: "desc" },
              take: 201,
              select: {
                id: true,
                planRevision: true,
                status: true,
                readSetJson: true,
                resultJson: true,
              },
            },
            outputs: {
              orderBy: { revision: "desc" },
              take: 21,
              select: {
                id: true,
                stepId: true,
                revision: true,
                contentJson: true,
              },
            },
          },
        })
      : [],
    tx.capture.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: { id: true, rawText: true, sourceType: true },
    }),
    tx.attachment.findMany({
      where: { projectId },
      orderBy: { id: "asc" },
      take: limit + 1,
      select: {
        id: true,
        fileName: true,
        sha256: true,
        extractionStatus: true,
        extractedText: true,
        revisions: {
          orderBy: { revisionIndex: "desc" },
          take: 1,
          select: { id: true, revisionIndex: true, text: true, source: true },
        },
      },
    }),
  ]);
  const serialized = relations.map((r) => ({
    ...r,
    relationType: r.relationType,
    confidence: r.confidence,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    validFrom: r.validFrom?.toISOString() ?? null,
    validTo: r.validTo?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    currentCard: {
      ...r.currentCard,
      createdAt: r.currentCard.createdAt.toISOString(),
    },
    relatedCard: {
      ...r.relatedCard,
      createdAt: r.relatedCard.createdAt.toISOString(),
    },
  })) satisfies TemporalRelationData[];
  const cardStates = cards.map((c) => ({
    id: c.id,
    state: evaluateTemporalCard(
      { ...c, createdAt: c.createdAt.toISOString() },
      serialized,
      now,
    ).topLevelState,
  }));
  const activeRelations = serialized.filter((r) =>
    isTemporalRelationActive(r, now),
  );
  const reasons: string[] = [];
  if (
    captures.length > limit ||
    attachments.length > limit ||
    cards.length > limit ||
    actions.length > limit ||
    deliverables.length > limit ||
    artifacts.length > limit ||
    missions.length > limit ||
    requirements.length > 1000 ||
    relations.length > 1000 ||
    deliverables.some((d) => d.evidences.length > 200) ||
    missions.some(
      (m) =>
        m.steps.length > 200 ||
        m.outputs.length > 20 ||
        m.externalSources.length > 200,
    )
  )
    reasons.push("NEIGHBORHOOD_LIMIT");
  const mutations = await tx.projectImpactJob.findMany({
    where: { projectId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 50,
    select: {
      id: true,
      mutationReceiptId: true,
      rootsJson: true,
      createdAt: true,
    },
  });
  // Semantic content and validity phases only. Reads, jobs, leases and event counters never rebase a proposal.
  const shared = {
    mutationVersions: mutations
      .filter(
        (m) =>
          Array.isArray(m.rootsJson) &&
          m.rootsJson.length > 0 &&
          !m.mutationReceiptId.startsWith("decision:"),
      )
      .map((m) => ({
        id: m.id,
        receiptId: m.mutationReceiptId,
        roots: m.rootsJson,
      })),
    captures,
    attachments,
    ruleVersion: IMPACT_RULE,
    project: {
      ...project,
      deadlinePhase: project.deadline
        ? +project.deadline <= +now
          ? "PAST"
          : "FUTURE"
        : "NONE",
    },
    cards: cards.map(({ createdAt, ...c }) => ({
      ...c,
      existencePhase: +createdAt <= +now ? "OBSERVED" : "FUTURE",
    })),
    relations: relations.map((r) => ({
      ...omit(r, ["createdAt"]),
      effective: activeRelations.some((a) => a.id === r.id),
    })),
    cardStates,
    actions,
    requirements: requirements.map((r) => omit(r, ["createdAt"])),
    deliverables: deliverables.map((d) => ({
      ...d,
      evidences: d.evidences.map((e) => omit(e, ["createdAt"])),
    })),
    artifacts,
  };
  const semanticMissions = missions.map((m) => ({
    ...omit(m, ["status", "steps", "budgetUsedJson", "updatedAt", "createdAt"]),
    readSets: m.steps
      .filter((step) => step.planRevision === m.planRevision)
      .map((step) => ({ id: step.id, readSetJson: step.readSetJson })),
  }));
  return {
    project,
    mutations,
    captures,
    attachments,
    cards,
    cardStates,
    relations: serialized,
    activeRelations,
    actions,
    requirements,
    deliverables,
    artifacts,
    missions,
    coverage: {
      state: reasons.length ? "INCOMPLETE" : "COMPLETE",
      reasons,
      covered: [
        "confirmed temporal relations",
        "action hard AND / soft requirements",
        "deliverable alternative evidence OR",
        "explicit output and artifact block sources",
      ],
      notCovered: [
        "external semantic entailment",
        "unmapped legacy artifact prose",
        "unbounded transitive inference",
      ],
    },
    sharedHash: jsonHash(shared),
    hash: jsonHash({ shared, missions: semanticMissions }),
    observedAt: now.toISOString(),
  };
}
export type DecisionSnapshot = Awaited<ReturnType<typeof readDecisionSnapshot>>;
export async function decisionSnapshot(projectId: string, userId: string) {
  return db.$transaction((tx) => readDecisionSnapshot(tx, projectId, userId));
}
