import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const evidenceDir = path.resolve("evidence/phase1-20260914-1835");
const databasePath = path.join(evidenceDir, "phase1-probe-rerun.db");
const legacyDatabasePath = path.join(evidenceDir, "phase1-legacy-upgrade-rerun.db");
const migrationsDirectory = path.resolve("prisma/migrations");
const phaseMigration = "20260914080000_phase1_reliability";

function applyMigrations(targetPath: string, includePhaseMigration: boolean) {
  if (fs.existsSync(targetPath)) throw new Error(`evidence database already exists: ${targetPath}`);
  const sqlite = new Database(targetPath);
  try {
    for (const migration of fs.readdirSync(migrationsDirectory).sort()) {
      if (!includePhaseMigration && migration === phaseMigration) continue;
      const migrationPath = path.join(migrationsDirectory, migration, "migration.sql");
      if (fs.existsSync(migrationPath)) sqlite.exec(fs.readFileSync(migrationPath, "utf8"));
    }
  } finally {
    sqlite.close();
  }
}

function columnNames(targetPath: string, table: string): string[] {
  const sqlite = new Database(targetPath, { readonly: true });
  try {
    return (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name);
  } finally {
    sqlite.close();
  }
}

function request(projectId: string, requestId: string, rawText: string) {
  return new Request(`http://localhost/api/projects/${projectId}/captures`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": requestId,
    },
    body: JSON.stringify({ rawText, sourceType: "实验记录", requestId }),
  });
}

async function main() {
  applyMigrations(databasePath, true);
  process.env.DATABASE_URL = `file:${databasePath.replaceAll("\\", "/")}`;
  process.env.LLM_MODE = "mock";
  process.env.PROJECT_STATE_ENABLED = "1";

  const { db } = await import("@/lib/db");
  const { POST: postCapture } = await import("@/app/api/projects/[id]/captures/route");
  const { createMeetingImpactPreview, confirmMeetingChanges } = await import("@/lib/services/meetingStateDiffService");
  const { assessActionFeasibility, updateActionFeasibilityInput } = await import("@/lib/services/actionFeasibilityService");

  const project = await db.project.create({
    data: {
      title: "Phase 1 独立证据项目",
      description: "仅用于本阶段回归探针，不使用开发库或外部模型。",
      goal: "验证可靠写入、会议确认和依赖评估",
      scenario: "COMPETITION",
    },
  });

  const concurrentId = "phase1-probe-concurrent";
  const concurrentResponses = await Promise.all(
    Array.from({ length: 10 }, () => postCapture(request(project.id, concurrentId, "探针并发记录：补充对照实验指标。"), { params: Promise.resolve({ id: project.id }) })),
  );
  const concurrentBodies = await Promise.all(concurrentResponses.map((response) => response.json()));
  const conflictResponse = await postCapture(
    request(project.id, concurrentId, "探针冲突记录：这是不同的原文。"),
    { params: Promise.resolve({ id: project.id }) },
  );
  const conflictBody = await conflictResponse.json();
  const distinctResponses = await Promise.all([
    postCapture(request(project.id, "phase1-probe-distinct-a", "探针同文记录：用户明确要求再建一条。"), { params: Promise.resolve({ id: project.id }) }),
    postCapture(request(project.id, "phase1-probe-distinct-b", "探针同文记录：用户明确要求再建一条。"), { params: Promise.resolve({ id: project.id }) }),
  ]);
  const distinctBodies = await Promise.all(distinctResponses.map(async (response) => ({ status: response.status, body: await response.json() })));
  const sameRequestCaptureCount = await db.capture.count({ where: { projectId: project.id, requestId: concurrentId } });
  const sameRequestCardIds = [...new Set(concurrentBodies.map((body) => body.card?.id))];

  const meetingCapture = await db.capture.create({ data: { projectId: project.id, rawText: "探针会议旧方案", sourceType: "会议" } });
  const meetingCard = await db.knowledgeCard.create({
    data: {
      projectId: project.id,
      captureId: meetingCapture.id,
      type: "meeting_note",
      title: "探针会议旧方案",
      summary: "探针会议旧方案",
      keywords: [],
      relatedTasks: [],
      nextActions: [],
      importance: 4,
    },
  });
  const meetingPreview = await createMeetingImpactPreview(project.id, {
    text: "探针会议旧方案改为探针会议新方案。",
    meetingDate: "2026-09-14",
  });
  const meetingChange = meetingPreview.typedChanges.find((change) => change.kind === "DECISION_SUPERSEDE");
  const meetingResults = await Promise.all([
    confirmMeetingChanges(project.id, {
      proposalId: meetingPreview.proposalId,
      sourceTextHash: meetingPreview.sourceTextHash,
      proposalVersion: meetingPreview.proposalVersion,
      selectedChangeIds: [meetingChange!.changeId],
    }),
    confirmMeetingChanges(project.id, {
      proposalId: meetingPreview.proposalId,
      sourceTextHash: meetingPreview.sourceTextHash,
      proposalVersion: meetingPreview.proposalVersion,
      selectedChangeIds: [meetingChange!.changeId],
    }),
  ]);
  const stalePreview = await createMeetingImpactPreview(project.id, {
    text: "截止时间改为2026-10-01",
    meetingDate: "2026-09-14",
  });
  await db.project.update({ where: { id: project.id }, data: { deadline: new Date("2026-11-01T00:00:00.000Z") } });
  let staleCode = "NONE";
  try {
    const deadlineChange = stalePreview.typedChanges[0];
    await confirmMeetingChanges(project.id, {
      proposalId: stalePreview.proposalId,
      sourceTextHash: stalePreview.sourceTextHash,
      proposalVersion: stalePreview.proposalVersion,
      selectedChangeIds: [deadlineChange.changeId],
    });
  } catch (error) {
    staleCode = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "UNKNOWN";
  }
  const preservedDeadline = (await db.project.findUniqueOrThrow({ where: { id: project.id } })).deadline?.toISOString() ?? null;

  const dependency = await db.actionItem.create({ data: { projectId: project.id, title: "探针依赖前置", status: "TODO", priority: 2 } });
  const action = await db.actionItem.create({ data: { projectId: project.id, title: "探针依赖目标", status: "TODO", priority: 2 } });
  await updateActionFeasibilityInput(project.id, {
    actionId: action.id,
    addRequirements: [{ targetKind: "action", targetId: dependency.id, hard: true, note: "硬依赖" }],
  });
  const beforeRequirement = await db.actionRequirement.findFirstOrThrow({ where: { actionId: action.id } });
  const replacedAssessment = await updateActionFeasibilityInput(project.id, {
    actionId: action.id,
    removeRequirementIds: [beforeRequirement.id],
    addRequirements: [{ targetKind: "action", targetId: dependency.id, hard: false, note: "软依赖" }],
  });
  const requirementsAfterReplace = await db.actionRequirement.findMany({ where: { actionId: action.id } });
  const versionAfterReplace = replacedAssessment.dependencyVersion;
  let invalidBatchCode = "NONE";
  try {
    await updateActionFeasibilityInput(project.id, {
      actionId: action.id,
      addRequirements: [
        { targetKind: "action", targetId: dependency.id },
        { targetKind: "action", targetId: "not-in-project" },
      ],
    });
  } catch (error) {
    invalidBatchCode = error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : "UNKNOWN";
  }
  const actionA = await db.actionItem.create({ data: { projectId: project.id, title: "探针环路 A", status: "TODO", priority: 2 } });
  const actionB = await db.actionItem.create({ data: { projectId: project.id, title: "探针环路 B", status: "TODO", priority: 2 } });
  const cycleResults = await Promise.allSettled([
    updateActionFeasibilityInput(project.id, { actionId: actionA.id, addRequirements: [{ targetKind: "action", targetId: actionB.id }] }),
    updateActionFeasibilityInput(project.id, { actionId: actionB.id, addRequirements: [{ targetKind: "action", targetId: actionA.id }] }),
  ]);
  const cycleEdgeCount = await db.actionRequirement.count({
    where: {
      projectId: project.id,
      targetKind: "action",
      OR: [
        { actionId: actionA.id, targetId: actionB.id },
        { actionId: actionB.id, targetId: actionA.id },
      ],
    },
  });
  const finalAssessment = await assessActionFeasibility(project.id, action.id);

  await db.$disconnect();
  applyMigrations(legacyDatabasePath, false);
  const legacyBefore = columnNames(legacyDatabasePath, "Capture");
  const sqlite = new Database(legacyDatabasePath);
  sqlite.exec(fs.readFileSync(path.join(migrationsDirectory, phaseMigration, "migration.sql"), "utf8"));
  sqlite.close();
  const legacyAfter = columnNames(legacyDatabasePath, "Capture");

  const result = {
    generatedAt: new Date().toISOString(),
    source: "独立 SQLite 数据库；LLM_MODE=mock；未使用开发库、个人登录态或外部凭据",
    migration: {
      emptyDatabaseReplay: true,
      oldDatabaseUpgrade: true,
      legacyCaptureColumnsBefore: legacyBefore,
      legacyCaptureColumnsAfter: legacyAfter,
      addedColumns: ["requestId", "requestHash"].filter((column) => !legacyBefore.includes(column) && legacyAfter.includes(column)),
    },
    a1: {
      concurrentStatusCounts: concurrentResponses.reduce<Record<string, number>>((counts, response) => {
        counts[String(response.status)] = (counts[String(response.status)] ?? 0) + 1;
        return counts;
      }, {}),
      sameRequestCardIds,
      sameRequestCaptureCount,
      conflictStatus: conflictResponse.status,
      conflictCode: conflictBody?.error?.code ?? null,
      distinctRequestStatuses: distinctBodies.map((item) => item.status),
      distinctRequestCardIds: distinctBodies.map((item) => item.body.card?.id ?? null),
    },
    a2: {
      proposalId: meetingPreview.proposalId,
      sourceCardId: meetingCard.id,
      concurrentAlreadyConfirmed: meetingResults.map((item) => item.alreadyConfirmed),
      concurrentResultCardIds: meetingResults.map((item) => item.applied[0]?.newCardId ?? null),
      staleDeadlineCode: staleCode,
      preservedDeadline,
    },
    a3: {
      replacedRequirementCount: requirementsAfterReplace.length,
      replacedRequirement: requirementsAfterReplace[0] ? {
        targetId: requirementsAfterReplace[0].targetId,
        hard: requirementsAfterReplace[0].hard,
        note: requirementsAfterReplace[0].note,
      } : null,
      versionAfterReplace,
      invalidBatchCode,
      finalAssessment: {
        feasibility: finalAssessment.feasibility,
        dependencyCount: finalAssessment.dependencies.length,
        dependencyVersion: finalAssessment.dependencyVersion,
      },
      cycleEdgeCount,
      cycleOperationStatuses: cycleResults.map((result) => result.status),
    },
  };
  fs.writeFileSync(path.join(evidenceDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(result, null, 2));
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
