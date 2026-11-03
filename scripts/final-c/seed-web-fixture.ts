/**
 * Track C EV1：隔离库 Web fixture 种子。
 *
 * 只写本工作树固定隔离库 `prisma/final-preparation.db`（file: SQLite，无 seed 的独立库），
 * 建立固定的本地测试账号、两个合成项目与多状态 Mission：
 *   1) WAITING_INPUT + 原问题（当前问题 + 历史旧问题）
 *   2) WAITING_APPROVAL + 未过期 PENDING 原审批（+ 历史 EXPIRED 旧审批）
 *   3) RUNNING + pauseRequestedAt（停止在途，lease 拉长以覆盖 EV2 窗口）
 *   4) SUCCEEDED + 草稿 Output + 已创建 Action（步骤引用）+ resultCardId 回执 + 归入回执
 *   5) FAILED（lastErrorJson TOOL_FAILED）
 *   6) PAUSED + UNKNOWN 未结算效果（lastErrorJson TOOL_UNKNOWN + UNKNOWN Step）
 *   7) WAITING_INPUT + 三条来源状态：SUPPRESSED / CHANGED / UNKNOWN（+ 一条 ALLOWED 对照）
 *   8) CANCELLED（带取消前草稿）
 *   9) 长标题/长文案 Project + Mission（390 长文案）
 *  10) SUCCEEDED + 未结算 UNKNOWN 效果（终态 + 未知调用并列）
 *
 * 边界：
 * - 运行前设置与 tmp/final-preparation/Start-Track.ps1 一致的最小 env（mock、隔离库、附件目录），
 *   之后才动态 import lib/db；不读 `.env`，不触碰真实库或其他 worktree。
 * - 不调用模型、不发网络、不写真实用户数据；所有文本均为合成内容。
 * - 表结构缺失时只对本隔离库执行 `prisma migrate deploy`，记录命令与退出码；不运行 db:setup。
 * - 输出 evidence/final-c/20261103/fixture-identity.json（含账号、项目、各 Mission 与目标对象 ID、
 *   数据库路径、迁移状态、命令与退出码）。账号/密码仅属于本地隔离库，不得复用。
 *
 * 运行：
 *   npm.cmd exec -- tsx scripts/final-c/seed-web-fixture.ts
 *
 * 退出码：0 = 身份文件已写出；非零 = 失败（仍尽力写 status=FAILED 的身份文件）。
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import {
  account,
  applyIsolatedEnv,
  attachmentDir,
  ensureEvidenceDirs,
  fixtureMarker,
  gitFacts,
  identityPath,
  isolatedDbPath,
  isolatedDbUrl,
  repoRoot,
  seedCommand,
  webBaseUrl,
  webPort,
  workerPresenceFile,
} from "./fixturePaths";

const prismaDirectory = path.join(path.dirname(isolatedDbPath));
const migrationsDirectory = path.join(prismaDirectory, "migrations");

type MigrationStatus = {
  databasePath: string;
  databaseUrl: string;
  existedBeforeRun: boolean;
  tableCount: number;
  appliedMigrationCount: number;
  expectedMigrationCount: number;
  missingMigrations: string[];
  action: "NONE" | "MIGRATE_DEPLOY" | "CREATE_AND_MIGRATE";
  command: string | null;
  exitCode: number | null;
  stdoutTail: string | null;
  stderrTail: string | null;
};

function readSchemaState(): {
  exists: boolean;
  tables: string[];
  applied: string[];
  expected: string[];
  missing: string[];
} {
  const expected = fs
    .readdirSync(migrationsDirectory)
    .filter((name) =>
      fs.existsSync(path.join(migrationsDirectory, name, "migration.sql")),
    )
    .sort();
  if (!fs.existsSync(isolatedDbPath)) {
    return { exists: false, tables: [], applied: [], expected, missing: expected };
  }
  const sql = new Database(isolatedDbPath, { readonly: true, fileMustExist: true });
  try {
    const tables = (
      sql.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    let applied: string[] = [];
    if (tables.includes("_prisma_migrations")) {
      applied = (
        sql
          .prepare(
            "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY started_at",
          )
          .all() as Array<{ migration_name: string }>
      ).map((row) => row.migration_name);
    }
    return {
      exists: true,
      tables,
      applied,
      expected,
      missing: expected.filter((name) => !applied.includes(name)),
    };
  } finally {
    sql.close();
  }
}

/**
 * 只对固定隔离库补齐表结构；任何其他目标一律拒绝。
 * 不运行 db:setup（含 seed），不迁移其他数据库。
 */
function ensureSchema(): MigrationStatus {
  const before = readSchemaState();
  const base: MigrationStatus = {
    databasePath: isolatedDbPath,
    databaseUrl: isolatedDbUrl,
    existedBeforeRun: before.exists,
    tableCount: before.tables.length,
    appliedMigrationCount: before.applied.length,
    expectedMigrationCount: before.expected.length,
    missingMigrations: before.missing,
    action: "NONE",
    command: null,
    exitCode: null,
    stdoutTail: null,
    stderrTail: null,
  };
  if (before.exists && before.missing.length === 0) return base;
  if (isolatedDbPath !== path.join(fs.realpathSync.native(prismaDirectory), "final-preparation.db")
      && path.resolve(isolatedDbPath) !== path.join(path.resolve(prismaDirectory), "final-preparation.db")) {
    throw new Error(`拒绝迁移非固定隔离库路径：${isolatedDbPath}`);
  }
  fs.mkdirSync(prismaDirectory, { recursive: true });
  if (!before.exists) {
    new Database(isolatedDbPath).close();
    base.action = "CREATE_AND_MIGRATE";
  } else {
    base.action = "MIGRATE_DEPLOY";
  }
  const prismaCli = path.join(prismaDirectory, "..", "node_modules", "prisma", "build", "index.js");
  const args = [prismaCli, "migrate", "deploy"];
  const result = spawnSync(process.execPath, args, {
    cwd: path.join(prismaDirectory, ".."),
    env: { ...process.env, DATABASE_URL: isolatedDbUrl },
    encoding: "utf8",
  });
  base.command = `node node_modules/prisma/build/index.js migrate deploy  (DATABASE_URL=${isolatedDbUrl})`;
  base.exitCode = result.status;
  base.stdoutTail = (result.stdout ?? "").trim().split(/\r?\n/).slice(-12).join("\n") || null;
  base.stderrTail = (result.stderr ?? "").trim().split(/\r?\n/).slice(-12).join("\n") || null;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`隔离库迁移失败（exit ${result.status}）：${base.stderrTail ?? ""}`);
  const after = readSchemaState();
  base.tableCount = after.tables.length;
  base.appliedMigrationCount = after.applied.length;
  base.missingMigrations = after.missing;
  if (after.missing.length) throw new Error(`迁移后仍缺表结构：${after.missing.join(", ")}`);
  return base;
}

type Json = never;

/** ID/对象引用集合，最终写入身份 JSON 供 EV2 核对“显示身份 == fixture 身份”。 */
type MissionIdentity = {
  key: string;
  id: string;
  projectKey: "primary" | "long";
  projectId: string;
  status: string;
  goal: string;
  expected: Record<string, unknown>;
  targets: Record<string, unknown>;
  readTarget?: Record<string, string | number>;
  siblingReadTargets?: Record<string, Record<string, string | number>>;
};

async function main() {
  ensureEvidenceDirs();
  if (
    path.resolve(isolatedDbPath) !==
    path.join(path.resolve(repoRoot), "prisma", "final-preparation.db")
  ) {
    throw new Error("隔离库不在本工作树 prisma/ 下，拒绝继续");
  }
  const git = gitFacts();
  const migration = ensureSchema();
  const envApplied = applyIsolatedEnv();
  fs.mkdirSync(attachmentDir, { recursive: true });
  fs.mkdirSync(path.dirname(workerPresenceFile), { recursive: true });
  // 本 fixture 不启动 Worker；确保读取到 UNOBSERVED，而不是其他实例遗留的心跳。
  try {
    fs.rmSync(workerPresenceFile, { force: true });
  } catch {
    /* 只影响展示，不中断 */
  }

  // 顺序要求：环境变量设置完成后才动态 import lib/**。
  const { db } = await import("../../lib/db");
  const { hashPassword } = await import("../../lib/auth/password");
  const { jsonHash, defaultBudget } = await import("../../lib/mission/contracts");
  const { readProjectMaterial } = await import("../../lib/mission/sourceSignals");

  const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Json;
  const now = () => Date.now();
  const at = (minutesFromNow: number) => new Date(now() + minutesFromNow * 60_000);
  const iso = (date: Date) => date.toISOString();

  async function cleanupPreviousFixture() {
    const oldProjects = await db.project.findMany({
      where: { description: { startsWith: fixtureMarker } },
      select: { id: true },
    });
    const projectIds = oldProjects.map((row) => row.id);
    if (projectIds.length) {
      // MissionArtifactReceipt 对 Mission/Output/Artifact 是 NoAction，先删回执再删项目。
      await db.missionArtifactReceipt.deleteMany({ where: { projectId: { in: projectIds } } });
      await db.generatedArtifact.deleteMany({ where: { projectId: { in: projectIds } } });
      await db.project.deleteMany({ where: { id: { in: projectIds } } });
    }
    await db.user.deleteMany({ where: { username: account.username } });
  }

  try {
    await cleanupPreviousFixture();

    // ---- 固定本地测试账号（仅本地隔离库；邮箱已验证） ----
    const passwordHash = await hashPassword(account.password);
    const user = await db.user.create({
      data: {
        username: account.username,
        displayName: account.displayName,
        passwordHash,
        continuitySeq: 1,
        security: {
          create: { email: account.email, emailVerifiedAt: new Date() },
        },
      } as never,
    });

    async function createProject(input: {
      title: string;
      description: string;
      goal: string;
      deadlineDays: number;
    }) {
      return db.project.create({
        data: {
          title: input.title,
          description: `${fixtureMarker}${input.description ? ` · ${input.description}` : ""}`,
          goal: input.goal,
          scenario: "RESEARCH",
          deadline: at(input.deadlineDays * 24 * 60),
          memberships: { create: { userId: user.id, role: "OWNER" } },
        } as never,
      });
    }

    const project = await createProject({
      title: "C 证据项目：多状态长期委托核对",
      description: "合成用户/合成项目，用于 Track C 正常与异常态 Web 证据；不含真实用户数据。",
      goal: "在隔离库里核对四问工作包、依据与来源许可、结果回执的 Web 呈现",
      deadlineDays: 9,
    });

    const longToken = `SYNTHETIC_LONG_UNBROKEN_TOKEN_${"X".repeat(96)}`;
    const longProject = await createProject({
      title: `超长标题项目：用于核对 390 像素宽度下项目标题、项目目标与委托长文案换行是否产生横向滚动（合成数据）${longToken.slice(0, 24)}`,
      description: `SYNTHETIC_LONG_COPY ${longToken} 这一行包含不可断行的长标识，用于核对移动端换行与横向溢出；内容全部为合成数据。`,
      goal: `核对长文案在 390 宽度下的换行、截断与可读性；不可断行标识 ${longToken}`,
      deadlineDays: 30,
    });

    // ---- 通用构造器 ----
    async function addEvent(
      missionId: string,
      type: string,
      payload: unknown,
      commandRequestId?: string,
    ) {
      const updated = await db.agentMission.update({
        where: { id: missionId },
        data: { nextEventSeq: { increment: 1 } },
        select: { nextEventSeq: true },
      });
      return db.agentMissionEvent.create({
        data: {
          missionId,
          seq: updated.nextEventSeq,
          type,
          payloadJson: json(payload),
          ...(commandRequestId ? { commandRequestId } : {}),
        } as never,
      });
    }

    type MissionSpec = {
      key: string;
      goal: string;
      status?: string;
      successCriteria?: string[];
      plan?: Record<string, unknown>;
      budgetUsed?: Record<string, number>;
      waitStateJson?: Record<string, unknown>;
      lastErrorJson?: Record<string, unknown>;
      leaseUntil?: Date;
      nextAttemptAt?: Date;
      pauseRequestedAt?: Date;
      pauseReason?: string | null;
      cancelRequestedAt?: Date;
      finishedAt?: Date;
      constraints?: Record<string, unknown>;
    };

    const missionIdentities: MissionIdentity[] = [];
    async function createMissionRow(
      projectId: string,
      projectKey: "primary" | "long",
      spec: MissionSpec,
    ) {
      const createRequestId = `final-c-${spec.key}-${randomUUID()}`;
      const mission = await db.agentMission.create({
        data: {
          ownerUserId: user.id,
          projectId,
          createRequestId,
          createPayloadHash: jsonHash({ createRequestId, goal: spec.goal }),
          goal: spec.goal,
          successCriteriaJson: json(spec.successCriteria ?? ["DRAFT_EXISTS"]),
          constraintsJson: json({ llmContextApproved: true, ...(spec.constraints ?? {}) }),
          researchScopeJson: json({}),
          continuationPolicyJson: json({ mode: "MANUAL" }),
          planJson: json(spec.plan ?? {}),
          budgetJson: json(defaultBudget),
          budgetUsedJson: json(spec.budgetUsed ?? {}),
          status: spec.status ?? "READY",
          ...(spec.waitStateJson ? { waitStateJson: json(spec.waitStateJson) } : {}),
          ...(spec.lastErrorJson ? { lastErrorJson: json(spec.lastErrorJson) } : {}),
          ...(spec.leaseUntil ? { leaseUntil: spec.leaseUntil } : {}),
          ...(spec.nextAttemptAt ? { nextAttemptAt: spec.nextAttemptAt } : {}),
          ...(spec.pauseRequestedAt ? { pauseRequestedAt: spec.pauseRequestedAt } : {}),
          ...(spec.pauseReason !== undefined ? { pauseReason: spec.pauseReason } : {}),
          ...(spec.cancelRequestedAt ? { cancelRequestedAt: spec.cancelRequestedAt } : {}),
          ...(spec.finishedAt ? { finishedAt: spec.finishedAt } : {}),
        } as never,
      });
      const identity: MissionIdentity = {
        key: spec.key,
        id: mission.id,
        projectKey,
        projectId,
        status: mission.status,
        goal: spec.goal,
        expected: {},
        targets: {},
      };
      missionIdentities.push(identity);
      return { mission, identity };
    }

    async function addStep(
      missionId: string,
      input: {
        ordinal: number;
        planRevision?: number;
        toolName: string;
        status: string;
        resultJson?: unknown;
        canonicalInputJson?: unknown;
        readSetJson?: unknown;
        failureJson?: unknown;
        startedAt?: Date;
        finishedAt?: Date;
      },
    ) {
      return db.agentMissionStep.create({
        data: {
          missionId,
          ordinal: input.ordinal,
          planRevision: input.planRevision ?? 1,
          toolName: input.toolName,
          toolVersion: "1",
          status: input.status,
          canonicalInputJson: json(input.canonicalInputJson ?? {}),
          inputHash: jsonHash({ missionId, ordinal: input.ordinal, tool: input.toolName }),
          readSetJson: json(input.readSetJson ?? []),
          ...(input.resultJson !== undefined ? { resultJson: json(input.resultJson) } : {}),
          ...(input.failureJson !== undefined ? { failureJson: json(input.failureJson) } : {}),
          ...(input.startedAt ? { startedAt: input.startedAt } : {}),
          ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
        } as never,
      });
    }

    async function materialOf(projectId: string, sourceId: string) {
      const material = await readProjectMaterial(projectId, sourceId);
      if (!material) throw new Error(`来源不可读：${sourceId}`);
      return material;
    }

    // =========================================================
    // 1) WAITING_INPUT + 原问题（当前问题 + 历史旧问题 + 一条可用资料）
    // =========================================================
    const questionMission = await createMissionRow(project.id, "primary", {
      key: "waitingUser",
      goal: "核对设备 D 在 2026-10 的真实显存峰值与测试条件",
      status: "WAITING_INPUT",
      successCriteria: ["DRAFT_EXISTS", "REQUIRED_INPUT_PRESENT"],
      budgetUsed: { models: 1, tools: 2 },
    });
    await addEvent(questionMission.mission.id, "CREATED", {
      goal: questionMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const oldQuestion = await addEvent(questionMission.mission.id, "QUESTION", {
      question: "旧问题：请补充设备 D 的历史预算结论（已被新问题取代，只读）。",
      missing: "PRIVATE",
      superseded: true,
    });
    const currentQuestion = await addEvent(questionMission.mission.id, "QUESTION", {
      question:
        "请补充设备 D 在 2026-10 的真实显存峰值（GB），以及 batch、序列长度和是否启用 KV cache。缺少这些条件时不会外推预算结论。",
      missing: "PRIVATE",
      requirements: {
        terms: [],
        unit: "GB",
        period: "2026-10",
        sourceType: "EITHER",
        metric: { name: "显存峰值", unit: "GB", period: "2026-10" },
      },
    });
    const questionCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText:
          "2026-10-18 设备 D 部署日志：模型 A v2，batch=1，序列长度 2048，显存峰值 6.8GB，未记录 KV cache 开关。",
        sourceType: "experiment_log",
        requestId: `final-c-question-${randomUUID()}`,
      } as never,
    });
    const questionMaterial = await materialOf(project.id, `capture:${questionCapture.id}`);
    await addStep(questionMission.mission.id, {
      ordinal: 1,
      toolName: "bind_project_sources",
      status: "SUCCEEDED",
      canonicalInputJson: { questionId: currentQuestion.id },
      resultJson: {
        data: { questionId: currentQuestion.id },
        sources: [
          {
            id: `capture:${questionCapture.id}`,
            hash: questionMaterial.hash,
            text: questionMaterial.text.slice(0, 400),
          },
        ],
      },
      startedAt: at(-12),
      finishedAt: at(-11),
    });
    await db.agentMission.update({
      where: { id: questionMission.mission.id },
      data: {
        waitStateJson: json({
          questionId: currentQuestion.id,
          question:
            "请补充设备 D 在 2026-10 的真实显存峰值（GB），以及 batch、序列长度和是否启用 KV cache。缺少这些条件时不会外推预算结论。",
          waitingFor: "USER",
          missing: "PRIVATE",
          resolved: false,
          startedAt: iso(at(-10)),
        }),
      } as never,
    });
    questionMission.identity.expected = {
      status: "WAITING_INPUT",
      phase: "WAITING_USER",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "QUESTION_PENDING",
      primaryActionKind: "ANSWER_QUESTION",
      waitingOn: "USER_INPUT",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "QUESTION_PENDING"],
      materialUses: {
        [`capture:${questionCapture.id}`]: {
          currentUse: "ALLOWED",
          revisionAvailability: "CURRENT",
          availability: "CURRENT",
        },
      },
      reviewProgress: { executed: 1, observed: 1 },
    };
    questionMission.identity.targets = {
      questionId: currentQuestion.id,
      oldQuestionId: oldQuestion.id,
      captureId: questionCapture.id,
      sourceId: `capture:${questionCapture.id}`,
    };
    questionMission.identity.readTarget = { questionId: currentQuestion.id };
    questionMission.identity.siblingReadTargets = {
      oldQuestion: { questionId: oldQuestion.id },
    };

    // =========================================================
    // 2) WAITING_APPROVAL + 未过期 PENDING 原审批（+ 历史 EXPIRED 旧审批）
    // =========================================================
    const approvalMission = await createMissionRow(project.id, "primary", {
      key: "waitingApproval",
      goal: "准备一次同条件复测，先审阅要创建的行动提案",
      status: "WAITING_APPROVAL",
      successCriteria: ["DRAFT_EXISTS", "ACTION_CREATED"],
    });
    await addEvent(approvalMission.mission.id, "CREATED", {
      goal: approvalMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const oldProposal = {
      tool: "create_action",
      args: {
        title: "旧提案：核对设备 D 显存预算（已过期，只读）",
        description: "历史提案，不得作为当前批准依据。",
        priority: 3,
      },
    };
    const oldApprovalStep = await addStep(approvalMission.mission.id, {
      ordinal: 2,
      toolName: "propose_action",
      status: "OBSOLETE",
      canonicalInputJson: oldProposal,
    });
    const oldApproval = await db.agentMissionApproval.create({
      data: {
        missionId: approvalMission.mission.id,
        stepId: oldApprovalStep.id,
        proposalHash: jsonHash(oldProposal),
        proposalJson: json(oldProposal),
        expectedPlanRevision: 1,
        readSetJson: json([]),
        status: "EXPIRED",
        expiresAt: at(-30),
        decidedAt: at(-45),
      } as never,
    });
    const proposal = {
      tool: "create_action",
      args: {
        title: "核对设备 D 显存预算并记录复测条件",
        description:
          "批准后只创建本项目 1 项待办；创建行动不代表实验完成，执行仍需在原行动中记录真实结果。",
        priority: 2,
        dueAt: iso(at(3 * 24 * 60)),
      },
    };
    const approvalStep = await addStep(approvalMission.mission.id, {
      ordinal: 1,
      toolName: "propose_action",
      status: "WAITING_APPROVAL",
      canonicalInputJson: proposal,
    });
    const pendingApproval = await db.agentMissionApproval.create({
      data: {
        missionId: approvalMission.mission.id,
        stepId: approvalStep.id,
        proposalHash: jsonHash(proposal),
        proposalJson: json(proposal),
        expectedPlanRevision: 1,
        readSetJson: json([]),
        status: "PENDING",
        expiresAt: at(6 * 60),
      } as never,
    });
    approvalMission.identity.expected = {
      status: "WAITING_APPROVAL",
      phase: "WAITING_APPROVAL",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "APPROVAL_PENDING",
      primaryActionKind: "REVIEW_APPROVAL",
      waitingOn: "USER_APPROVAL",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "APPROVAL_PENDING"],
      primaryActionTarget: { kind: "APPROVAL", id: pendingApproval.id, version: null },
      selectedApprovalStatus: "PENDING",
      oldSelectedApprovalStatus: "EXPIRED",
    };
    approvalMission.identity.targets = {
      approvalId: pendingApproval.id,
      oldApprovalId: oldApproval.id,
      approvalStepId: approvalStep.id,
      proposalHash: jsonHash(proposal),
      oldProposalHash: jsonHash(oldProposal),
    };
    approvalMission.identity.readTarget = { approvalId: pendingApproval.id };
    approvalMission.identity.siblingReadTargets = {
      oldApproval: { approvalId: oldApproval.id },
    };

    // =========================================================
    // 3) RUNNING + pauseRequestedAt（停止在途）
    // =========================================================
    const stoppedMission = await createMissionRow(project.id, "primary", {
      key: "stopRequested",
      goal: "持续核对部署日志与显存预算（停止请求已受理，等待结算）",
      status: "RUNNING",
      budgetUsed: { models: 1, tools: 1 },
      // lease 拉长：EV2 可能晚于种子数小时，仍要展示“停止在途”而不是租约过期。
      leaseUntil: at(6 * 60),
      pauseRequestedAt: at(-5 / 60),
    });
    await addEvent(stoppedMission.mission.id, "CREATED", {
      goal: stoppedMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    await addEvent(stoppedMission.mission.id, "PAUSE", {
      requestId: "final-c-stop-request",
      source: "USER",
    });
    await addStep(stoppedMission.mission.id, {
      ordinal: 1,
      toolName: "inspect_project",
      status: "RUNNING",
      canonicalInputJson: { query: "部署日志与显存预算" },
      startedAt: at(-2),
    });
    stoppedMission.identity.expected = {
      status: "RUNNING",
      phase: "RUNNING",
      nextActor: "SYSTEM",
      requiresUser: false,
      reasonCode: "STOP_REQUESTED_IN_FLIGHT",
      primaryActionKind: "CHECK_STOP_SETTLEMENT",
      waitingOn: "SYSTEM_SETTLEMENT",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "PAUSE_REQUESTED"],
      stopRequestState: "PAUSE_REQUESTED",
      stopRequestSettled: false,
    };

    // =========================================================
    // 4) SUCCEEDED + 草稿 Output + Action + resultCardId 回执 + 归入回执
    // =========================================================
    const succeededMission = await createMissionRow(project.id, "primary", {
      key: "succeeded",
      goal: "整理阶段汇报草稿，并记录一次真实行动结果回执",
      status: "SUCCEEDED",
      successCriteria: ["DRAFT_EXISTS", "ACTION_CREATED", "ACTION_RESULT_RECORDED"],
      plan: { delegation: { lastObservedAt: iso(at(-30)) } },
      budgetUsed: { models: 2, tools: 3, inputTokens: 120, outputTokens: 80 },
      finishedAt: at(-60),
    });
    await addEvent(succeededMission.mission.id, "CREATED", {
      goal: succeededMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const contentCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText:
          "2026-10-20 复测记录：设备 D，模型 A v2，batch=1，序列长度 2048，显存峰值 6.8GB；未记录 KV cache 开关。",
        sourceType: "experiment_log",
        requestId: `final-c-succeeded-content-${randomUUID()}`,
      } as never,
    });
    const resultCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText:
          "2026-10-22 行动结果：已核对设备 D 的显存预算口径，并把复测条件写入阶段汇报；KV cache 开关仍待确认。",
        sourceType: "experiment_log",
        requestId: `final-c-succeeded-result-${randomUUID()}`,
      } as never,
    });
    // 草稿实际引用的项目资料：绑定步骤 + 逐块 sourceIds + 精确摘录，
    // 让读回出现 BOUND / OUTPUT_REFERENCE / EXACT_QUOTE，并给 C2 的纠正入口提供原草稿引用。
    const outputMaterialCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText:
          "2026-10-20 复测条件记录：设备 D，模型 A v2，batch=1，序列长度 2048，显存峰值 6.8GB，预算上限 6GB。",
        sourceType: "experiment_log",
        requestId: `final-c-succeeded-material-${randomUUID()}`,
      } as never,
    });
    const outputMaterial = await materialOf(project.id, `capture:${outputMaterialCapture.id}`);
    const quoteStart = 0;
    const quoteEnd = Math.min(48, outputMaterial.text.length);
    const exactQuote = outputMaterial.text.slice(quoteStart, quoteEnd);
    const exactQuoteHash = createHash("sha256").update(exactQuote).digest("hex");
    const resultCard = await db.knowledgeCard.create({
      data: {
        projectId: project.id,
        captureId: resultCapture.id,
        type: "experiment_log",
        title: "行动完成复盘：显存预算核对",
        summary:
          "用户报告已完成复测条件核对；KV cache 开关仍为未知，不当作已确认。",
        keywords: json(["显存预算", "复测条件"]),
        relatedTasks: json([]),
        nextActions: json(["确认 KV cache 开关后补充记录"]),
        importance: 3,
      } as never,
    });
    const resultAction = await db.actionItem.create({
      data: {
        projectId: project.id,
        title: "核对设备 D 显存预算并记录复测条件",
        description:
          "完成后填写复盘回执；创建行动不等于现实实验完成，回执仍是用户报告。",
        priority: 2,
        status: "DONE",
        completedAt: at(-120),
        resultText: "已核对并记录复测条件；KV cache 开关待确认。",
        resultCardId: resultCard.id,
        isSimulated: false,
        createdAt: at(-180),
      } as never,
    });
    const draftOutput = await db.agentMissionOutput.create({
      data: {
        missionId: succeededMission.mission.id,
        revision: 1,
        kind: "DRAFT",
        contentJson: json({
          blocks: [
            {
              blockId: "b1",
              kind: "OBSERVATION",
              text: "项目记录显示设备 D 显存峰值 6.8GB，超过 6GB 预算；条件为 batch=1、序列长度 2048。",
              sourceIds: [`capture:${outputMaterialCapture.id}`],
              citations: [
                {
                  sourceId: `capture:${outputMaterialCapture.id}`,
                  start: quoteStart,
                  end: quoteEnd,
                  excerptHash: exactQuoteHash,
                },
              ],
            },
            {
              blockId: "b2",
              kind: "INFERENCE",
              text: "建议把复测条件与预算口径写入阶段汇报；缺少 KV cache 开关记录仍是信息缺口。",
              sourceIds: [],
            },
            {
              blockId: "b3",
              kind: "EXTERNAL_REFERENCE",
              text: "行动回执：用户报告已完成核对，但现实效果仍以原行动回执为准。",
              sourceIds: [],
            },
          ],
        }),
        sourceRefsJson: json([
          {
            sourceId: `capture:${outputMaterialCapture.id}`,
            id: `capture:${outputMaterialCapture.id}`,
            hash: outputMaterial.hash,
            text: outputMaterial.text,
          },
        ]),
        claimChecksJson: json({
          status: "NOT_CHECKED",
          checks: [
            { blockId: "b1", status: "NOT_CHECKED" },
            { blockId: "b2", status: "NOT_CHECKED" },
          ],
        }),
        verificationStatus: "NEEDS_REVIEW",
        createdAt: at(-150),
      } as never,
    });
    await addStep(succeededMission.mission.id, {
      ordinal: 1,
      toolName: "search_memory",
      status: "SUCCEEDED",
      resultJson: { sources: [{ id: `capture:${contentCapture.id}` }] },
      startedAt: at(-170),
      finishedAt: at(-169),
    });
    await addStep(succeededMission.mission.id, {
      ordinal: 2,
      toolName: "save_mission_output",
      status: "SUCCEEDED",
      resultJson: { data: { outputId: draftOutput.id, revision: 1 } },
      startedAt: at(-160),
      finishedAt: at(-159),
    });
    await addStep(succeededMission.mission.id, {
      ordinal: 3,
      toolName: "create_action",
      status: "SUCCEEDED",
      resultJson: {
        data: {
          actionId: resultAction.id,
          title: resultAction.title,
          status: "DONE",
          resultCardId: resultCard.id,
        },
      },
      startedAt: at(-140),
      finishedAt: at(-139),
    });
    await addStep(succeededMission.mission.id, {
      ordinal: 4,
      toolName: "bind_project_sources",
      status: "SUCCEEDED",
      canonicalInputJson: { questionId: null },
      resultJson: {
        data: { questionId: null },
        sources: [
          {
            id: `capture:${outputMaterialCapture.id}`,
            hash: outputMaterial.hash,
            text: outputMaterial.text.slice(0, 400),
          },
        ],
      },
      startedAt: at(-155),
      finishedAt: at(-154),
    });
    const artifact = await db.generatedArtifact.create({
      data: {
        projectId: project.id,
        artifactType: "weekly_report",
        content:
          "# 阶段汇报（草稿）\n\n## 已完成\n- 核对设备 D 显存峰值 6.8GB 与测试条件。\n\n## 未知\n- KV cache 开关未记录。\n\n## 下一步\n- 确认开关后补充记录。\n",
        sourceRefs: json({ sources: [] }),
        claims: json({ status: "UNMAPPED_MODEL", claims: [] }),
        createdAt: at(-140),
      } as never,
    });
    const artifactReceipt = await db.missionArtifactReceipt.create({
      data: {
        projectId: project.id,
        missionId: succeededMission.mission.id,
        outputId: draftOutput.id,
        outputRevision: 1,
        outputHash: jsonHash({ outputId: draftOutput.id, revision: 1 }),
        artifactId: artifact.id,
        artifactType: "weekly_report",
        sourceManifestJson: json({ sources: [] }),
        blockMapJson: json({ blocks: [{ blockId: "b1" }, { blockId: "b2" }, { blockId: "b3" }] }),
        verificationSnapshotJson: json({ verificationStatus: "NEEDS_REVIEW" }),
        createdByUserId: user.id,
        requestId: `final-c-artifact-${randomUUID()}`,
        payloadHash: jsonHash({ artifactId: artifact.id, outputId: draftOutput.id }),
        createdAt: at(-130),
      } as never,
    });
    succeededMission.identity.expected = {
      status: "SUCCEEDED",
      phase: "COMPLETED",
      nextActor: "NONE",
      requiresUser: false,
      reasonCode: "SUCCEEDED",
      primaryActionKind: "VIEW_RESULT",
      waitingOn: "NONE",
      observationState: "OBSERVED",
      blockerCodes: [],
      latestOutput: { id: draftOutput.id, revision: 1 },
      actionReceipts: [
        {
          actionId: resultAction.id,
          status: "DONE",
          resultCardId: resultCard.id,
          isSimulated: false,
        },
      ],
      adoptions: [{ receiptId: artifactReceipt.id, artifactId: artifact.id }],
      reviewProgress: { executed: 4, observed: 2, userReported: 1 },
      materialUses: {
        [`capture:${outputMaterialCapture.id}`]: {
          currentUse: "ALLOWED",
          revisionAvailability: "CURRENT",
          availability: "CURRENT",
        },
      },
      materialUseCount: 1,
      correctionTargetAvailable: true,
    };
    succeededMission.identity.targets = {
      outputId: draftOutput.id,
      outputRevision: 1,
      receiptId: artifactReceipt.id,
      artifactId: artifact.id,
      actionId: resultAction.id,
      resultCardId: resultCard.id,
      resultCardCaptureId: resultCapture.id,
      contentCaptureId: contentCapture.id,
      outputMaterialSourceId: `capture:${outputMaterialCapture.id}`,
      outputMaterialHash: outputMaterial.hash,
      exactQuote,
      stepIds: [
        ...(await db.agentMissionStep.findMany({
          where: { missionId: succeededMission.mission.id },
          orderBy: { ordinal: "asc" },
          select: { id: true, ordinal: true, toolName: true },
        })).map((step) => ({ id: step.id, ordinal: step.ordinal, toolName: step.toolName })),
      ],
    };
    succeededMission.identity.readTarget = {
      outputId: draftOutput.id,
      revision: 1,
      receiptId: artifactReceipt.id,
    };

    // =========================================================
    // 5) FAILED（执行失败，保留进度）
    // =========================================================
    const failedMission = await createMissionRow(project.id, "primary", {
      key: "failed",
      goal: "读取项目资料并核对失败原因",
      status: "FAILED",
      budgetUsed: { tools: 1 },
      lastErrorJson: {
        code: "TOOL_FAILED",
        message: "读取项目资料步骤未完成，已保存进度",
        phase: "TOOL",
      },
    });
    await addEvent(failedMission.mission.id, "CREATED", {
      goal: failedMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    await addStep(failedMission.mission.id, {
      ordinal: 1,
      toolName: "inspect_project",
      status: "FAILED",
      failureJson: {
        code: "TOOL_FAILED",
        message: "读取项目资料步骤未完成，已保存进度",
      },
      startedAt: at(-90),
      finishedAt: at(-89),
    });
    failedMission.identity.expected = {
      status: "FAILED",
      phase: "FAILED",
      nextActor: "SYSTEM",
      requiresUser: false,
      reasonCode: "TOOL_FAILED",
      primaryActionKind: "REVIEW_FAILURE",
      waitingOn: "SYSTEM_RECHECK",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "TOOL_FAILED"],
    };

    // =========================================================
    // 6) PAUSED + UNKNOWN 未结算效果（lastErrorJson + UNKNOWN Step）
    // =========================================================
    const unknownMission = await createMissionRow(project.id, "primary", {
      key: "unknown",
      goal: "核对一次外部调用结果尚未结算的委托",
      status: "PAUSED",
      pauseRequestedAt: at(-40),
      pauseReason: "USER",
      lastErrorJson: {
        code: "TOOL_UNKNOWN",
        message: "原外部请求结果尚未结算，读取不会自动核销",
      },
      budgetUsed: { models: 1, tools: 1, unknownCalls: 1 },
    });
    await addEvent(unknownMission.mission.id, "CREATED", {
      goal: unknownMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    await addStep(unknownMission.mission.id, {
      ordinal: 1,
      toolName: "inspect_project",
      status: "UNKNOWN",
      failureJson: {
        code: "TOOL_UNKNOWN",
        message: "原外部请求结果尚未结算",
      },
      startedAt: at(-60),
      finishedAt: at(-59),
    });
    unknownMission.identity.expected = {
      status: "PAUSED",
      phase: "UNKNOWN",
      nextActor: "SYSTEM",
      requiresUser: false,
      reasonCode: "TOOL_UNKNOWN",
      primaryActionKind: "RECHECK_AUTHORITY",
      waitingOn: "SYSTEM_RECHECK",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "TOOL_UNKNOWN"],
      unsettledEffect: {
        present: true,
        code: "TOOL_UNKNOWN",
        source: "LAST_ERROR",
      },
      stopRequestState: "PAUSE_SETTLED",
      stopRequestSettled: true,
    };

    // =========================================================
    // 7) 来源状态：SUPPRESSED / CHANGED / UNKNOWN（+ ALLOWED 对照）
    // =========================================================
    const materialMission = await createMissionRow(project.id, "primary", {
      key: "sourceStates",
      goal: "核对三条项目资料的当前可用性与修订状态",
      status: "WAITING_INPUT",
      successCriteria: ["DRAFT_EXISTS", "REQUIRED_INPUT_PRESENT"],
    });
    await addEvent(materialMission.mission.id, "CREATED", {
      goal: materialMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const materialQuestion = await addEvent(materialMission.mission.id, "QUESTION", {
      question:
        "请核对资料状态：哪一条被当前许可抑制、哪一条修订已变化、哪一条来源链未知；历史留痕保留但不得当作当前依据。",
      missing: "PRIVATE",
    });
    const allowedCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText: "项目资料 A（允许使用）：2026-10-18 设备 D 显存峰值 6.8GB，条件 batch=1。",
        sourceType: "experiment_log",
        requestId: `final-c-material-a-${randomUUID()}`,
      } as never,
    });
    const changedCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText: "项目资料 B（旧版本）：预算口径为 GPU 峰值显存，未含缓存。",
        sourceType: "requirement",
        requestId: `final-c-material-b-${randomUUID()}`,
      } as never,
    });
    const changedMaterialBefore = await materialOf(project.id, `capture:${changedCapture.id}`);
    // 模拟来源修订：写入新版本，使已绑定的旧 hash 变为 CHANGED。
    await db.capture.update({
      where: { id: changedCapture.id },
      data: {
        rawText:
          "项目资料 B（2026-11-02 修订）：预算口径改为峰值显存 + 缓存占用，需要重新核对原结论。",
      } as never,
    });
    const changedMaterialAfter = await materialOf(project.id, `capture:${changedCapture.id}`);
    const suppressedCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText: "项目资料 C（当前许可被用户撤回）：仅在历史留痕中保留身份，不作为当前依据。",
        sourceType: "meeting_note",
        requestId: `final-c-material-c-${randomUUID()}`,
      } as never,
    });
    const suppressedMaterial = await materialOf(project.id, `capture:${suppressedCapture.id}`);
    const missingCapture = await db.capture.create({
      data: {
        projectId: project.id,
        rawText: "项目资料 D（随后被移除）：来源链无法解析，读取时只保留指针。",
        sourceType: "idea",
        requestId: `final-c-material-d-${randomUUID()}`,
      } as never,
    });
    const missingMaterial = await materialOf(project.id, `capture:${missingCapture.id}`);
    const allowedMaterial = await materialOf(project.id, `capture:${allowedCapture.id}`);
    await addStep(materialMission.mission.id, {
      ordinal: 1,
      toolName: "bind_project_sources",
      status: "SUCCEEDED",
      canonicalInputJson: { questionId: materialQuestion.id },
      resultJson: {
        data: { questionId: materialQuestion.id },
        sources: [
          {
            id: `capture:${allowedCapture.id}`,
            hash: allowedMaterial.hash,
            text: allowedMaterial.text.slice(0, 400),
          },
          {
            id: `capture:${changedCapture.id}`,
            hash: changedMaterialBefore.hash,
            text: changedMaterialBefore.text.slice(0, 400),
          },
          {
            id: `capture:${suppressedCapture.id}`,
            hash: suppressedMaterial.hash,
            text: suppressedMaterial.text.slice(0, 400),
          },
          {
            id: `capture:${missingCapture.id}`,
            hash: missingMaterial.hash,
            text: missingMaterial.text.slice(0, 400),
          },
        ],
      },
      startedAt: at(-20),
      finishedAt: at(-19),
    });
    // 用户当前许可撤回：只影响“当前能否作为依据”，历史身份与摘录仍保留在原记录。
    await db.agentDirectiveEvent.create({
      data: {
        id: randomUUID(),
        ownerUserId: user.id,
        seq: 1,
        commandId: `final-c-suppress-${randomUUID()}`,
        eventIndex: 0,
        inputHash: jsonHash({ kind: "USE_SUPPRESSION", sourceId: `capture:${suppressedCapture.id}` }),
        directiveId: "final-c-source-suppression",
        previousEventId: null,
        projectId: project.id,
        conversationId: null,
        missionId: null,
        kind: "USE_SUPPRESSION",
        operation: "SUPPRESS_USE",
        quote: "停止使用资料 C 作为当前依据（隔离库合成指令）",
        sourceJson: json({ origin: "FIXTURE_ONLY", actorUserId: user.id }),
        admissionJson: json({ status: "DIRECT_APPLIED", kind: "USE_SUPPRESSION" }),
        sourceIdsJson: json([`capture:${suppressedCapture.id}`]),
        validFrom: at(-15),
        validUntil: null,
        timezone: "Asia/Shanghai",
      } as never,
    });
    // 删除来源 D 的原始 Capture：指针仍在历史步骤里，但来源链解析不到 → UNKNOWN。
    await db.capture.delete({ where: { id: missingCapture.id } });
    await db.agentMission.update({
      where: { id: materialMission.mission.id },
      data: {
        waitStateJson: json({
          questionId: materialQuestion.id,
          question:
            "请核对资料状态：哪一条被当前许可抑制、哪一条修订已变化、哪一条来源链未知；历史留痕保留但不得当作当前依据。",
          waitingFor: "USER",
          missing: "PRIVATE",
          resolved: false,
          startedAt: iso(at(-18)),
        }),
      } as never,
    });
    materialMission.identity.expected = {
      status: "WAITING_INPUT",
      phase: "WAITING_USER",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "QUESTION_PENDING",
      primaryActionKind: "ANSWER_QUESTION",
      waitingOn: "USER_INPUT",
      observationState: "NOT_OBSERVED",
      blockerCodes: [
        "WORKER_PRESENCE_UNOBSERVED",
        "QUESTION_PENDING",
        "SOURCE_CHANGED",
        "SOURCE_UNAVAILABLE",
        "CURRENT_USE_SUPPRESSED",
        "CURRENT_USE_UNKNOWN",
      ],
      materialUses: {
        [`capture:${allowedCapture.id}`]: {
          currentUse: "ALLOWED",
          revisionAvailability: "CURRENT",
          availability: "CURRENT",
        },
        [`capture:${changedCapture.id}`]: {
          currentUse: "ALLOWED",
          revisionAvailability: "CHANGED",
          availability: "CHANGED",
        },
        [`capture:${suppressedCapture.id}`]: {
          currentUse: "SUPPRESSED",
          revisionAvailability: "CURRENT",
          availability: "UNAVAILABLE",
        },
        [`capture:${missingCapture.id}`]: {
          currentUse: "UNKNOWN",
          revisionAvailability: "UNAVAILABLE",
          availability: "UNAVAILABLE",
        },
      },
      materialUseCount: 4,
    };
    materialMission.identity.targets = {
      questionId: materialQuestion.id,
      allowedSourceId: `capture:${allowedCapture.id}`,
      changedSourceId: `capture:${changedCapture.id}`,
      changedHashBefore: changedMaterialBefore.hash,
      changedHashAfter: changedMaterialAfter.hash,
      suppressedSourceId: `capture:${suppressedCapture.id}`,
      unknownSourceId: `capture:${missingCapture.id}`,
      suppressionDirectiveId: "final-c-source-suppression",
    };
    materialMission.identity.readTarget = { questionId: materialQuestion.id };

    // =========================================================
    // 8) CANCELLED（取消前草稿保留）
    // =========================================================
    const cancelledMission = await createMissionRow(project.id, "primary", {
      key: "cancelled",
      goal: "取消前保留的委托示例：核对部署日志",
      status: "CANCELLED",
      cancelRequestedAt: at(-35),
      finishedAt: at(-35),
    });
    await addEvent(cancelledMission.mission.id, "CREATED", {
      goal: cancelledMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const cancelledOutput = await db.agentMissionOutput.create({
      data: {
        missionId: cancelledMission.mission.id,
        revision: 1,
        kind: "DRAFT",
        contentJson: json({
          blocks: [
            {
              blockId: "c1",
              kind: "OBSERVATION",
              text: "取消前草稿：已核对部署日志中的显存峰值，但尚未完成条件核对。",
              sourceIds: [],
            },
          ],
        }),
        sourceRefsJson: json([]),
        claimChecksJson: json({ status: "NOT_CHECKED", checks: [] }),
        verificationStatus: "NEEDS_REVIEW",
        createdAt: at(-50),
      } as never,
    });
    cancelledMission.identity.expected = {
      status: "CANCELLED",
      phase: "COMPLETED",
      nextActor: "NONE",
      requiresUser: false,
      reasonCode: "CANCELLED",
      primaryActionKind: "VIEW_RESULT",
      waitingOn: "NONE",
      observationState: "NOT_OBSERVED",
      blockerCodes: [],
      stopRequestState: "CANCEL_SETTLED",
      stopRequestSettled: true,
      latestOutput: { id: cancelledOutput.id, revision: 1 },
    };
    cancelledMission.identity.targets = {
      outputId: cancelledOutput.id,
      outputRevision: 1,
    };
    cancelledMission.identity.readTarget = { outputId: cancelledOutput.id, revision: 1 };

    // =========================================================
    // 9) 长标题/长文案 Project + Mission（390）
    // =========================================================
    const longGoal = `核对长文案：${longToken} 以及一段很长的中文说明，用于确认 390 像素宽度下顶部四问、依据摘录与结果回执不会产生横向滚动；这段文字重复出现以模拟真实长文案。`;
    const longMission = await createMissionRow(longProject.id, "long", {
      key: "longCopy",
      goal: longGoal,
      status: "WAITING_INPUT",
      successCriteria: ["DRAFT_EXISTS", "REQUIRED_INPUT_PRESENT"],
    });
    await addEvent(longMission.mission.id, "CREATED", {
      goal: longGoal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    const longQuestion = await addEvent(longMission.mission.id, "QUESTION", {
      question: `请补充以下长问题的答案：${longToken}；并说明测试条件、设备编号、批次、序列长度、是否启用缓存，以及你认为还缺少哪些信息。`,
      missing: "PRIVATE",
      requirements: { terms: [], unit: "", period: "", sourceType: "EITHER" },
    });
    await db.agentMission.update({
      where: { id: longMission.mission.id },
      data: {
        waitStateJson: json({
          questionId: longQuestion.id,
          question: `请补充以下长问题的答案：${longToken}；并说明测试条件、设备编号、批次、序列长度、是否启用缓存，以及你认为还缺少哪些信息。`,
          waitingFor: "USER",
          missing: "PRIVATE",
          resolved: false,
          startedAt: iso(at(-8)),
        }),
      } as never,
    });
    longMission.identity.expected = {
      status: "WAITING_INPUT",
      phase: "WAITING_USER",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "QUESTION_PENDING",
      primaryActionKind: "ANSWER_QUESTION",
      waitingOn: "USER_INPUT",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["WORKER_PRESENCE_UNOBSERVED", "QUESTION_PENDING"],
    };
    longMission.identity.targets = {
      questionId: longQuestion.id,
      longToken,
    };
    longMission.identity.readTarget = { questionId: longQuestion.id };

    // =========================================================
    // 10) SUCCEEDED + 未结算 UNKNOWN 效果（终态与未知并列）
    // =========================================================
    const terminalUnknownMission = await createMissionRow(project.id, "primary", {
      key: "terminalUnknown",
      goal: "完成条件已通过，但有一次外部调用结果尚未结算",
      status: "SUCCEEDED",
      successCriteria: ["DRAFT_EXISTS"],
      lastErrorJson: {
        code: "TOOL_UNKNOWN",
        message: "完成条件已通过，但有一次外部调用结果尚未结算；读取不会自动核销",
      },
      finishedAt: at(-70),
      budgetUsed: { tools: 1, unknownCalls: 1 },
    });
    await addEvent(terminalUnknownMission.mission.id, "CREATED", {
      goal: terminalUnknownMission.mission.goal,
      constraints: {},
      researchScope: {},
      llmContextApproved: true,
    });
    terminalUnknownMission.identity.expected = {
      status: "SUCCEEDED",
      phase: "COMPLETED",
      nextActor: "USER",
      requiresUser: true,
      reasonCode: "SUCCEEDED",
      primaryActionKind: "CHECK_UNKNOWN_EFFECT",
      waitingOn: "NONE",
      observationState: "NOT_OBSERVED",
      blockerCodes: ["TOOL_UNKNOWN"],
      unsettledEffect: {
        present: true,
        code: "TOOL_UNKNOWN",
        source: "LAST_ERROR",
      },
    };

    // ---- 身份文件：账号、项目、Mission/Sibling 目标、数据库与迁移状态 ----
    const identity = {
      schemaVersion: 1,
      track: "C",
      mode: "EV1_ISOLATED_WEB_FIXTURE",
      generatedAt: new Date().toISOString(),
      command: seedCommand,
      exitCode: 0,
      git,
      environment: {
        worktree: repoRoot,
        workingDirectory: process.cwd(),
        databasePath: isolatedDbPath,
        databaseUrl: isolatedDbUrl,
        attachmentDir,
        workerPresenceFile,
        llmMode: "mock",
        modelProviderCalls: 0,
        workerStarted: false,
        env: envApplied,
        note: "隔离 SQLite；LLM_MODE=mock；未启动 Worker；未读取 .env；未写真实库/其他 worktree；未调用模型。",
      },
      schemaMigration: migration,
      account: {
        ...account,
        note: "固定本地测试账号，只存在于本工作树隔离库 prisma/final-preparation.db；密码为合成值，不得在真实环境复用。",
        emailNote: "邮箱使用 .invalid 顶级域，仅用于满足已验证邮箱字段，不会收信。",
        loginEndpoint: "POST /api/auth/login {username,password}",
      },
      projects: {
        primary: { id: project.id, title: project.title, goal: project.goal },
        long: { id: longProject.id, title: longProject.title, goal: longProject.goal },
      },
      routes: {
        focus: "/focus",
        missionDetailPattern: "/projects/{projectId}/missions?mission={missionId}",
        readback: "/api/missions/{missionId}/readback",
        missionDetailApi: "/api/missions/{missionId}",
        login: "/login",
      },
      missions: missionIdentities,
      dataProvenance: {
        kind: "SYNTHETIC_ONLY",
        marker: fixtureMarker,
        statement:
          "合成用户、合成项目与合成委托；不含真实用户数据、凭据或个人信息。所有时间戳相对种子运行时刻生成。",
      },
      webPreview: {
        command: "tmp/final-preparation/Start-Track.ps1",
        baseUrl: webBaseUrl,
        port: webPort,
        note: "EV2 开始前由 Lead 通知 code green 后启动单一 dev 实例；本文件不启动任何服务。",
      },
    };
    fs.writeFileSync(identityPath, `${JSON.stringify(identity, null, 2)}\n`, "utf8");
    const counts = {
      users: await db.user.count(),
      projects: await db.project.count(),
      missions: await db.agentMission.count(),
      events: await db.agentMissionEvent.count(),
      steps: await db.agentMissionStep.count(),
      approvals: await db.agentMissionApproval.count(),
      outputs: await db.agentMissionOutput.count(),
      receipts: await db.missionArtifactReceipt.count(),
      actions: await db.actionItem.count(),
      captures: await db.capture.count(),
    };
    console.log(
      JSON.stringify(
        {
          ok: true,
          identityPath,
          databasePath: isolatedDbPath,
          migrationAction: migration.action,
          migrationExitCode: migration.exitCode,
          user: account.username,
          projects: { primary: project.id, long: longProject.id },
          missions: Object.fromEntries(
            missionIdentities.map((row) => [
              row.key,
              {
                id: row.id,
                projectId: row.projectId,
                status: row.status,
                expectedPhase: (row.expected as { phase?: string }).phase,
                expectedPrimaryAction: (row.expected as { primaryActionKind?: string }).primaryActionKind,
                readTarget: row.readTarget ?? {},
              },
            ]),
          ),
          counts,
        },
        null,
        2,
      ),
    );
    await db.$disconnect();
    process.exitCode = 0;
  } catch (error) {
    console.error("[final-c seed] 失败：", error);
    try {
      await db.$disconnect();
    } catch {
      /* ignore */
    }
    const failure = {
      schemaVersion: 1,
      track: "C",
      mode: "EV1_ISOLATED_WEB_FIXTURE",
      generatedAt: new Date().toISOString(),
      command: seedCommand,
      exitCode: 1,
      git,
      environment: {
        databasePath: isolatedDbPath,
        databaseUrl: isolatedDbUrl,
        attachmentDir,
        llmMode: "mock",
      },
      schemaMigration: migration,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? (error.stack ?? "").split(/\r?\n/).slice(0, 12) : [],
      },
      note: "种子失败；证据保留原错误，不伪造 fixture 身份。",
    };
    fs.writeFileSync(identityPath, `${JSON.stringify(failure, null, 2)}\n`, "utf8");
    process.exitCode = 1;
  }
}

void main();
