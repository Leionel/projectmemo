import { AppError } from "@/lib/api";
import { isFeatureEnabled } from "@/lib/config/features";
import { db } from "@/lib/db";
import { loadTemporalProject } from "@/lib/repositories/temporalRelations";
import { buildProjectState } from "@/lib/projectState/buildSnapshot";
import { computeProjectStateDiff, isRebuildRequiredError } from "@/lib/projectState/computeDiff";
import {
  PROJECT_STATE_POLICY_VERSION,
  PROJECT_STATE_SCHEMA_VERSION,
  type ProjectStateDiff,
  type ProjectStatePayload,
} from "@/lib/types/projectState";
import type { Prisma } from "@/lib/generated/prisma/client";

export interface ProjectStateSnapshotData {
  id: string;
  projectId: string;
  schemaVersion: number;
  policyVersion: string;
  sourceHash: string;
  evaluationKey: string;
  contentHash: string;
  observedAt: string;
  evaluatedAt: string;
  previousSnapshotId: string | null;
  payload: ProjectStatePayload;
}

export interface RefreshResult {
  snapshot: ProjectStateSnapshotData;
  changed: boolean;
  reused: boolean;
  baselineCreated: boolean;
}

function serializeSnapshot(row: {
  id: string;
  projectId: string;
  schemaVersion: number;
  policyVersion: string;
  sourceHash: string;
  evaluationKey: string;
  contentHash: string;
  observedAt: Date;
  evaluatedAt: Date;
  previousSnapshotId: string | null;
  payload: unknown;
}): ProjectStateSnapshotData {
  return {
    id: row.id,
    projectId: row.projectId,
    schemaVersion: row.schemaVersion,
    policyVersion: row.policyVersion,
    sourceHash: row.sourceHash,
    evaluationKey: row.evaluationKey,
    contentHash: row.contentHash,
    observedAt: row.observedAt.toISOString(),
    evaluatedAt: row.evaluatedAt.toISOString(),
    previousSnapshotId: row.previousSnapshotId,
    payload: row.payload as unknown as ProjectStatePayload,
  };
}

function ensureEnabled() {
  if (!isFeatureEnabled("PROJECT_STATE_ENABLED", false)) {
    throw new AppError("PROJECT_STATE_DISABLED", "项目状态功能当前已关闭", 503);
  }
}

/** 从数据库读取规范化源数据；接受事务客户端，与快照写入同事务，不拼接并发版本 */
async function loadSourceInput(tx: Prisma.TransactionClient, projectId: string): Promise<Parameters<typeof buildProjectState>[0]> {
  const { cards, relations } = await loadTemporalProject(projectId, tx);
  const [project, actions, deliverables] = await Promise.all([
    tx.project.findUnique({ where: { id: projectId }, select: { goal: true, deadline: true } }),
    tx.actionItem.findMany({
      where: { projectId },
      select: { id: true, title: true, status: true, resultCardId: true, completedAt: true, dueAt: true },
      orderBy: { createdAt: "asc" },
    }),
    tx.deliverable.findMany({
      where: { milestone: { projectId } },
      select: {
        id: true,
        expectedEvidence: true,
        evidences: { select: { evidenceType: true, confirmed: true } },
      },
    }),
  ]);
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "没有找到这个项目", 404);

  const cardIds = new Set(cards.map((card) => card.id));
  const relationRows = relations
    .filter((relation) => relation.relationType !== "RELATED")
    .map((relation) => ({
      id: relation.id,
      relationType: relation.relationType,
      reason: relation.reason,
      confirmed: relation.confirmed,
      confirmedAt: relation.confirmedAt ? relation.confirmedAt.toISOString() : null,
      revokedAt: relation.revokedAt ? relation.revokedAt.toISOString() : null,
      validFrom: relation.validFrom ? relation.validFrom.toISOString() : null,
      validTo: relation.validTo ? relation.validTo.toISOString() : null,
      createdAt: relation.createdAt.toISOString(),
      currentCardId: relation.currentCardId,
      relatedCardId: relation.relatedCardId,
      counterpartTitle: relation.currentCardId === relation.relatedCardId ? "" : relation.currentCard.title,
    }))
    .filter((relation) => cardIds.has(relation.currentCardId) && cardIds.has(relation.relatedCardId));

  return {
    projectId,
    goal: project.goal ?? null,
    deadline: project.deadline ? project.deadline.toISOString() : null,
    cards: cards.map((card) => ({
      id: card.id,
      title: card.title,
      summary: card.summary,
      createdAt: card.createdAt.toISOString(),
    })),
    relations: relationRows,
    actions: actions.map((action) => ({
      id: action.id,
      title: action.title,
      status: action.status,
      resultCardId: action.resultCardId,
      completedAt: action.completedAt ? action.completedAt.toISOString() : null,
      dueAt: action.dueAt ? action.dueAt.toISOString() : null,
    })),
    deliverables: deliverables.map((deliverable) => {
      let expected: string[] = [];
      try {
        const parsed: unknown = JSON.parse(deliverable.expectedEvidence);
        if (Array.isArray(parsed)) expected = parsed.filter((item): item is string => typeof item === "string");
      } catch {
        expected = [];
      }
      return {
        id: deliverable.id,
        expectedEvidenceTypes: expected,
        confirmedEvidenceTypes: deliverable.evidences
          .filter((evidence) => evidence.confirmed)
          .map((evidence) => evidence.evidenceType),
      };
    }),
    now: new Date().toISOString(),
  };
}

export async function getLatestProjectState(projectId: string): Promise<ProjectStateSnapshotData | null> {
  ensureEnabled();
  const row = await db.projectStateSnapshot.findFirst({
    where: { projectId },
    orderBy: { evaluatedAt: "desc" },
  });
  return row ? serializeSnapshot(row) : null;
}

export async function refreshProjectState(projectId: string): Promise<RefreshResult> {
  ensureEnabled();
  // 源读取与快照写入同一事务：并发业务写入不会拼出混合版本的源数据
  return db.$transaction(async (tx) => {
    const input = await loadSourceInput(tx, projectId);
    const built = buildProjectState(input);
    const now = new Date();

    const latest = await tx.projectStateSnapshot.findFirst({
      where: { projectId },
      orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
    });

    // 仅当最新行对应当前源版本时复用：历史行命中同键不代表状态未变（A→B→A 必须产生新记录）
    if (
      latest &&
      latest.sourceHash === built.sourceHash &&
      latest.policyVersion === PROJECT_STATE_POLICY_VERSION &&
      latest.evaluationKey === built.evaluationKey
    ) {
      return {
        snapshot: serializeSnapshot(latest),
        changed: false,
        reused: true,
        baselineCreated: false,
      };
    }

    const previousSnapshotId = latest?.id ?? null;

    try {
      const payload = {
        ...built,
        snapshotId: "",
      } as unknown as Prisma.InputJsonValue;

      const created = await tx.projectStateSnapshot.create({
        data: {
          projectId,
          schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
          policyVersion: PROJECT_STATE_POLICY_VERSION,
          sourceHash: built.sourceHash,
          evaluationKey: built.evaluationKey,
          contentHash: built.contentHash,
          observedAt: now,
          evaluatedAt: now,
          previousSnapshotId,
          payload,
        },
      });

      // 回填 snapshotId 进 payload，保证快照自描述
      const payloadWithId = {
        ...built,
        snapshotId: created.id,
      } as unknown as Prisma.InputJsonValue;
      const finalized = await tx.projectStateSnapshot.update({
        where: { id: created.id },
        data: { payload: payloadWithId },
      });

      return {
        snapshot: serializeSnapshot(finalized),
        changed: latest ? latest.contentHash !== built.contentHash : true,
        reused: false,
        baselineCreated: !latest,
      };
    } catch (error) {
      // 并发写入撞唯一约束（同源 + 同前驱）：读取并发方已生成的行，不重复写入
      if (
        typeof error === "object" && error !== null && "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        const conflicting = await tx.projectStateSnapshot.findFirst({
          where: {
            projectId,
            sourceHash: built.sourceHash,
            policyVersion: PROJECT_STATE_POLICY_VERSION,
            evaluationKey: built.evaluationKey,
            previousSnapshotId,
          },
          orderBy: [{ evaluatedAt: "desc" }, { id: "desc" }],
        });
        if (conflicting) {
          return {
            snapshot: serializeSnapshot(conflicting),
            changed: false,
            reused: true,
            baselineCreated: false,
          };
        }
      }
      throw error;
    }
  });
}

export async function getProjectStateDiff(projectId: string, fromId: string, toId: string): Promise<ProjectStateDiff> {
  ensureEnabled();
  const [fromRow, toRow] = await Promise.all([
    db.projectStateSnapshot.findFirst({ where: { id: fromId, projectId } }),
    db.projectStateSnapshot.findFirst({ where: { id: toId, projectId } }),
  ]);
  if (!fromRow || !toRow) {
    throw new AppError("SNAPSHOT_NOT_FOUND", "状态快照不存在或不属于当前项目", 404);
  }
  const from = fromRow.payload as unknown as ProjectStatePayload;
  const to = toRow.payload as unknown as ProjectStatePayload;
  try {
    return computeProjectStateDiff(from, to);
  } catch (error) {
    if (isRebuildRequiredError(error)) {
      throw new AppError("REBUILD_REQUIRED", "状态版本不兼容，需要重建基线，历史快照已保留", 409);
    }
    throw error;
  }
}

export interface CheckInResult {
  status: "OK" | "ALREADY_SEEN";
  lastSeenSnapshotId: string;
}

/** 用户确实读完后更新游标；只推进（按快照评估时间），不倒退 */
export async function checkInProjectState(
  projectId: string,
  input: { displayedSnapshotId: string; consumerKey: string },
): Promise<CheckInResult> {
  ensureEnabled();
  const displayed = await db.projectStateSnapshot.findFirst({
    where: { id: input.displayedSnapshotId, projectId },
  });
  if (!displayed) {
    throw new AppError("SNAPSHOT_NOT_FOUND", "要确认的状态快照不存在或不属于当前项目", 404);
  }

  return db.$transaction(async (tx) => {
    const cursor = await tx.projectStateCursor.findUnique({
      where: { projectId_consumerKey: { projectId, consumerKey: input.consumerKey } },
    });
    if (cursor) {
      const lastSeen = await tx.projectStateSnapshot.findUnique({ where: { id: cursor.lastSeenSnapshotId } });
      if (lastSeen && lastSeen.evaluatedAt.getTime() > displayed.evaluatedAt.getTime()) {
        return { status: "ALREADY_SEEN" as const, lastSeenSnapshotId: cursor.lastSeenSnapshotId };
      }
      if (cursor.lastSeenSnapshotId === displayed.id) {
        return { status: "ALREADY_SEEN" as const, lastSeenSnapshotId: cursor.lastSeenSnapshotId };
      }
      await tx.projectStateCursor.update({
        where: { id: cursor.id },
        data: { lastSeenSnapshotId: displayed.id },
      });
      return { status: "OK" as const, lastSeenSnapshotId: displayed.id };
    }
    await tx.projectStateCursor.create({
      data: {
        projectId,
        consumerKey: input.consumerKey,
        lastSeenSnapshotId: displayed.id,
      },
    });
    return { status: "OK" as const, lastSeenSnapshotId: displayed.id };
  });
}

export async function getProjectStateCursor(projectId: string, consumerKey: string) {
  ensureEnabled();
  return db.projectStateCursor.findUnique({
    where: { projectId_consumerKey: { projectId, consumerKey } },
  });
}
