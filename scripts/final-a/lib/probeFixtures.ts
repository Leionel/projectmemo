/**
 * A1 探针共享 fixture（只写临时库）。本文件只做类型导入，不静态加载 lib/ 运行时模块，
 * 以保证调用方可以先设置 DATABASE_URL 再动态 import "@/lib/db"。
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../../../lib/generated/prisma/client";

export const DEFAULT_BUDGET = {
  models: 12,
  tools: 16,
  searches: 3,
  fetches: 4,
  browserRequests: 40,
  browserBytes: 4_000_000,
  calendarRequests: 8,
  externalWrites: 2,
  activeMs: 180_000,
  reservedOutputTokens: 12_000,
};

export type ProbeOwner = { userId: string; projectId: string };

export type SourcePointer = { id: string; hash: string };

export async function createOwner(db: PrismaClient, label: string): Promise<ProbeOwner> {
  const user = await db.user.create({
    data: {
      username: `final-a-${label}-${randomUUID()}`,
      displayName: `A1 探针 ${label}`,
      passwordHash: "unused",
    },
  });
  const project = await db.project.create({
    data: {
      title: `A1 探针项目 ${label}`,
      description: "SYNTHETIC_FINAL_A_PROBE",
      goal: "验证委托服务级状态合同",
      scenario: "RESEARCH",
      memberships: { create: { userId: user.id, role: "OWNER" } },
    },
  });
  return { userId: user.id, projectId: project.id };
}

type MissionOverrides = {
  status?: string;
  goal?: string;
  planJson?: Prisma.InputJsonValue;
  constraintsJson?: Prisma.InputJsonValue;
  continuationPolicyJson?: Prisma.InputJsonValue;
  successCriteriaJson?: Prisma.InputJsonValue;
  budgetJson?: Prisma.InputJsonValue;
  budgetUsedJson?: Prisma.InputJsonValue;
  leaseUntil?: Date | null;
  nextAttemptAt?: Date | null;
  lastErrorJson?: Prisma.InputJsonValue;
  pauseRequestedAt?: Date | null;
  pauseReason?: string | null;
  cancelRequestedAt?: Date | null;
  waitStateJson?: Prisma.InputJsonValue;
  contextVersion?: number;
  planRevision?: number;
  constraintsVersion?: number;
  version?: number;
};

/** 直接 Prisma 造最小 Mission 行（探针 fixture，不经过创建服务）。 */
export async function createMission(
  db: PrismaClient,
  owner: ProbeOwner,
  overrides: MissionOverrides = {},
): Promise<{ id: string; version: number }> {
  const row = await db.agentMission.create({
    data: {
      ownerUserId: owner.userId,
      projectId: owner.projectId,
      createRequestId: `probe-${randomUUID()}`,
      createPayloadHash: `probe-hash-${randomUUID()}`,
      goal: overrides.goal ?? "探针委托：核对状态合同",
      successCriteriaJson: overrides.successCriteriaJson ?? ["DRAFT_EXISTS"],
      constraintsJson: overrides.constraintsJson ?? {},
      researchScopeJson: {},
      continuationPolicyJson: overrides.continuationPolicyJson ?? { mode: "MANUAL" },
      planJson: overrides.planJson ?? {},
      budgetJson: overrides.budgetJson ?? DEFAULT_BUDGET,
      ...overrides,
    },
  });
  return { id: row.id, version: row.version };
}

/** 按真实 event() 的 nextEventSeq 递增方式追加事件。 */
export async function addEvent(
  db: PrismaClient,
  missionId: string,
  type: string,
  payloadJson: unknown,
): Promise<{ id: string; seq: number }> {
  const mission = await db.agentMission.update({
    where: { id: missionId },
    data: { nextEventSeq: { increment: 1 } },
    select: { nextEventSeq: true },
  });
  const row = await db.agentMissionEvent.create({
    data: { missionId, seq: mission.nextEventSeq, type, payloadJson: payloadJson as never },
  });
  return { id: row.id, seq: row.seq };
}

/**
 * 造一条 SUCCEEDED 的 bind_project_sources 步骤：
 * materialUseProjection 只在 resultJson.data.questionId 匹配时把 sources 计为 BOUND。
 */
export async function addBoundSourcesStep(
  db: PrismaClient,
  input: {
    missionId: string;
    questionId: string;
    pointer: SourcePointer;
    text?: string;
    ordinal?: number;
  },
): Promise<{ id: string }> {
  const row = await db.agentMissionStep.create({
    data: {
      missionId: input.missionId,
      ordinal: input.ordinal ?? 1,
      planRevision: 1,
      toolName: "bind_project_sources",
      status: "SUCCEEDED",
      canonicalInputJson: { questionId: input.questionId, sourceId: input.pointer.id },
      inputHash: `probe-input-${randomUUID()}`,
      readSetJson: [],
      resultJson: {
        data: { questionId: input.questionId },
        sources: [
          {
            id: input.pointer.id,
            kind: "PROJECT",
            entityType: "CAPTURE",
            revision: input.pointer.hash,
            hash: input.pointer.hash,
            text: input.text ?? "",
            observedAt: new Date().toISOString(),
          },
        ],
      },
      finishedAt: new Date(),
    },
  });
  return { id: row.id };
}

/** 项目内 AgentRun（trace 自定义）；AgentRun 没有 mission 列，归属靠 trace.missionId。 */
export async function addAgentRun(
  db: PrismaClient,
  input: {
    projectId: string;
    trace: unknown;
    createdAt?: Date;
    runType?: "CAPTURE" | "EVALUATE" | "ACTION" | "ARTIFACT" | "CHAT";
    status?: "SUCCESS" | "PARTIAL" | "FALLBACK" | "FAILED";
    provider?: string;
  },
): Promise<{ id: string }> {
  const row = await db.agentRun.create({
    data: {
      projectId: input.projectId,
      runType: input.runType ?? "CHAT",
      status: input.status ?? "SUCCESS",
      provider: input.provider ?? "PROBE_FIXTURE",
      trace: input.trace as never,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
  return { id: row.id };
}
