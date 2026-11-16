import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { defaultBudget, json, jsonHash, type Source } from "@/lib/mission/contracts";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { textHash } from "@/lib/research/sourceRepository";
import { boundedInvestigationPolicySchema } from "@/lib/types/mission";
import { repositoryGrantBinding } from "@/lib/sensing/repoGrantBinding";
import { buildRoutingInput } from "@/lib/skills/routingContext";
import type { EvidenceState, SkillRoutingInput } from "@/lib/skills/router";

/**
 * Evaluation-only fixture materializer: turns the frozen scenario descriptions into real
 * isolated SQLite records (Project/Capture/Mission/Step/Output/Connection/Artifact).
 * It reads only `fixtures` from the frozen dataset; frozen expectations never enter routing.
 */

export type FixtureRefs = {
  fixtureId: string;
  ownerUserId: string;
  projectId: string | null;
  missionId: string | null;
  candidateMissions: Array<{ id: string; projectId: string; goal: string; status: string }>;
  sources: Source[];
  outputId: string | null;
  evidence: EvidenceState;
  connectionIds: string[];
  artifactId: string | null;
  artifactReceiptCount: number;
  foreignProjectId: string | null;
  actorCanAccessProject: boolean;
};

type FixtureDescriptor = {
  projectTitle: string | null;
  scenario: "RESEARCH" | "COURSE_DESIGN";
  goal: string;
  captures: string[];
  mission: { goal: string; status: "READY" | "WAITING_INPUT"; waitFor?: "OBSERVATION" } | null;
  evidence: EvidenceState;
  output: boolean;
  artifact: boolean;
  publicResearch?: boolean;
  connection?: boolean;
  foreign?: boolean;
  ambiguous?: boolean;
};

const DESCRIPTORS: Record<string, FixtureDescriptor> = {
  research_active: {
    projectTitle: "科研阶段汇报", scenario: "RESEARCH", goal: "整理可核查的实验阶段汇报",
    captures: [
      "实验阶段记录 2026-11-10\n测试集A：20 人；测试集B：12 人。\n准确率 0.82；召回率 0.65。\n两次实验的测试集不同，指标不能直接比较；seed 条件尚未记录。",
      "补充记录\n科目,成绩,得分\n数学,88,90\n英语,91,87\n语文,79,80\n说明：表格缺少单位与口径，按未知保留，不得推断单位。",
    ],
    mission: { goal: "整理可核查的实验阶段汇报", status: "WAITING_INPUT", waitFor: "OBSERVATION" },
    evidence: "PARTIAL", output: false, artifact: false,
  },
  research_ready: {
    projectTitle: "科研阶段汇报", scenario: "RESEARCH", goal: "整理可核查的实验阶段汇报",
    captures: [
      "实验阶段记录 2026-11-10\n测试集A：20 人；测试集B：12 人。\n准确率 0.82；召回率 0.65。\n两次实验的测试集不同，指标不能直接比较；seed 条件尚未记录。",
      "补充记录\n科目,成绩,得分\n数学,88,90\n英语,91,87\n语文,79,80\n说明：表格缺少单位与口径，按未知保留，不得推断单位。",
    ],
    mission: { goal: "整理可核查的实验阶段汇报", status: "READY" },
    evidence: "VALID", output: true, artifact: true,
  },
  course_new: {
    projectTitle: "数据库课程设计", scenario: "COURSE_DESIGN", goal: "完成数据库课程设计交付",
    captures: ["课程设计要求\n1. 提交数据库设计说明\n2. 提交 SQL 脚本\n3. 提交演示视频\n截止日期：未写明。评分口径未给出。"],
    mission: null, evidence: "REQUIREMENTS", output: false, artifact: false,
  },
  course_active: {
    projectTitle: "数据库课程设计", scenario: "COURSE_DESIGN", goal: "完成数据库课程设计交付",
    captures: [
      "课程设计要求\n1. 提交数据库设计说明\n2. 提交 SQL 脚本\n3. 提交演示视频\n截止日期：未写明。评分口径未给出。",
      "SQL 实现记录：已建立外键约束；索引方案待核对。",
    ],
    mission: { goal: "整理课程设计交付", status: "READY" },
    evidence: "PARTIAL", output: false, artifact: false,
  },
  software_active: {
    projectTitle: "发布准备", scenario: "RESEARCH", goal: "整理下一版本发布说明",
    captures: ["提交记录 a1b2c3：修复登录流程。\nCI 状态：失败，未部署。\n发布检查清单：尚未核对。"],
    mission: { goal: "整理下一版本发布说明", status: "READY" },
    evidence: "PARTIAL", output: false, artifact: false, connection: true,
  },
  public_research: {
    projectTitle: "公开方法评估", scenario: "RESEARCH", goal: "在批准的公开范围内评估方法",
    captures: ["内部评估记录：公开评估方法与本地实验口径不同，需分别说明。"],
    mission: { goal: "在批准的公开范围内评估方法", status: "WAITING_INPUT", waitFor: "OBSERVATION" },
    evidence: "PARTIAL", output: false, artifact: false, publicResearch: true,
  },
  empty_goal: {
    projectTitle: null, scenario: "RESEARCH", goal: "", captures: [], mission: null,
    evidence: "NONE", output: false, artifact: false,
  },
  ambiguous: {
    projectTitle: null, scenario: "RESEARCH", goal: "", captures: [], mission: null,
    evidence: "PARTIAL", output: false, artifact: false, ambiguous: true,
  },
  denied: {
    projectTitle: "他人的项目", scenario: "RESEARCH", goal: "他人的报告",
    captures: ["他人的私有记录，不得跨账号读取。"],
    mission: { goal: "整理他人的报告", status: "READY" },
    evidence: "NONE", output: false, artifact: false, foreign: true,
  },
};

function policyFor(connectionIds: string[]) {
  return boundedInvestigationPolicySchema.parse({
    mode: "BOUNDED_INVESTIGATION" as const, schemaVersion: 1 as const,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), checkEveryMinutes: 60,
    maxModels: 24, maxTools: 32, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output", "inspect_project", "search_memory", "read_repository_ci", "read_ci_jobs"] as Array<"read_project_material" | "save_mission_output" | "inspect_project" | "search_memory" | "read_repository_ci" | "read_ci_jobs">,
    connectionIds, trackBranchHead: false, timezone: "Asia/Shanghai",
  });
}

async function user(label: string) {
  return db.user.create({ data: { username: "eval-" + label + "-" + randomUUID().slice(0, 8), displayName: label, passwordHash: "unused-eval" } });
}

async function project(ownerUserId: string, title: string, goal: string, scenario: "RESEARCH" | "COURSE_DESIGN") {
  return db.project.create({ data: { title, description: "隔离评测合成资料，不含个人数据", goal, scenario,
    memberships: { create: { userId: ownerUserId, role: "OWNER" } } } });
}

async function capture(projectId: string, text: string) {
  return db.capture.create({ data: { projectId, rawText: text, sourceType: "TEXT" } });
}

async function mission(ownerUserId: string, projectId: string, goal: string, status: "READY" | "WAITING_INPUT", waitFor?: "OBSERVATION", connectionIds: string[] = [], researchScope: Record<string, unknown> = {}) {
  const policy = policyFor(connectionIds);
  const connectionVersions: Record<string, number> = {}, grantBindings: Record<string, unknown> = {};
  for (const connectionId of connectionIds) {
    const connection = await db.sourceConnection.findUniqueOrThrow({ where: { id: connectionId } });
    connectionVersions[connectionId] = connection.revision;
    grantBindings[connectionId] = repositoryGrantBinding(connection, connection.revision);
  }
  return db.agentMission.create({ data: {
    ownerUserId, projectId, createRequestId: "eval-" + randomUUID(), createPayloadHash: "eval-fixture",
    runtimeProtocolVersion: 2, goal, status, successCriteriaJson: ["DRAFT_EXISTS"],
    constraintsJson: json({ llmContextApproved: true }), researchScopeJson: json(researchScope),
    continuationPolicyJson: policy, budgetJson: defaultBudget, planRevision: 1, contextVersion: 1,
    planJson: json({ delegation: { policyHash: jsonHash(policy), connectionVersions, grantBindings, grantRunIds: [], attention: null, wakeSeq: 0 } }),
    ...(status === "WAITING_INPUT" ? { waitStateJson: json({ waitingFor: waitFor ?? "USER", startedAt: new Date().toISOString() }) } : {}),
  } });
}

async function priorRead(missionId: string, sources: Source[]) {
  await db.agentMissionStep.create({ data: {
    missionId, ordinal: 1, planRevision: 1, toolName: "read_project_material", toolVersion: "1", status: "SUCCEEDED",
    canonicalInputJson: { sourceId: sources[0]?.id, sourceHash: sources[0]?.hash }, inputHash: "eval-" + randomUUID(),
    readSetJson: json(sources), resultJson: json({ data: {}, sources }), finishedAt: new Date(),
  } });
}

async function outputVersion(missionId: string, sources: Source[]) {
  const source = sources[0];
  const excerpt = source.text.slice(0, 160);
  return db.agentMissionOutput.create({ data: {
    missionId, revision: 1, kind: "NOTE", verificationStatus: "NEEDS_REVIEW",
    contentJson: { schemaVersion: 1, kind: "NOTE", blocks: [
      { blockId: "current-record", kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + excerpt, sourceIds: [source.id],
        citations: [{ sourceId: source.id, start: 0, end: excerpt.length, excerptHash: textHash(excerpt) }] },
      { blockId: "next-step", kind: "INFERENCE", text: "尚缺条件按原资料保留为未知；私有草稿不代表现实完成。", sourceIds: [] },
    ] },
    sourceRefsJson: json(sources), claimChecksJson: [],
  } });
}

async function adoptedArtifact(ownerUserId: string, projectId: string, missionId: string, output: { id: string; revision: number; contentJson: unknown }, source: Source) {
  const artifact = await db.generatedArtifact.create({ data: { projectId, artifactType: "readme", content: "已采纳的发布说明（冻结版本）" } });
  await db.missionArtifactReceipt.create({ data: {
    projectId, missionId, outputId: output.id, outputRevision: output.revision, outputHash: jsonHash(output.contentJson),
    artifactId: artifact.id, artifactType: "readme", sourceManifestJson: { sources: [source.id] },
    blockMapJson: {}, verificationSnapshotJson: {}, createdByUserId: ownerUserId, requestId: "eval-" + randomUUID(), payloadHash: "eval-fixture",
  } });
  return artifact;
}

/** Create the evaluation Mission for a fixture that starts without one (new project request). */
export async function createFixtureMission(ownerUserId: string, projectId: string, goal: string) {
  const m = await mission(ownerUserId, projectId, goal, "READY");
  return m.id;
}

export async function materializeFixture(fixtureId: string): Promise<FixtureRefs> {
  const descriptor = DESCRIPTORS[fixtureId];
  if (!descriptor) throw new Error("UNKNOWN_FIXTURE:" + fixtureId);
  const owner = await user("owner-" + fixtureId);
  const refs: FixtureRefs = {
    fixtureId, ownerUserId: owner.id, projectId: null, missionId: null, candidateMissions: [], sources: [],
    outputId: null, evidence: descriptor.evidence, connectionIds: [], artifactId: null, artifactReceiptCount: 0,
    foreignProjectId: null, actorCanAccessProject: true,
  };
  if (descriptor.ambiguous) {
    const projects = await Promise.all(["p-research", "p-course"].map(async (tag, index) => {
      const row = await project(owner.id, "评测项目" + (index + 1), "阶段报告" + (index + 1), index ? "COURSE_DESIGN" : "RESEARCH");
      await capture(row.id, tag + "：项目记录，报告草稿待整理。");
      const m = await mission(owner.id, row.id, "整理阶段报告" + (index + 1), "WAITING_INPUT", "OBSERVATION");
      return { projectId: row.id, mission: m };
    }));
    refs.candidateMissions = projects.map(row => ({ id: row.mission.id, projectId: row.projectId, goal: row.mission.goal, status: row.mission.status }));
    return refs;
  }
  if (descriptor.foreign) {
    const foreign = await user("foreign");
    const row = await project(foreign.id, descriptor.projectTitle!, descriptor.goal, descriptor.scenario);
    await capture(row.id, descriptor.captures[0]);
    const m = await mission(foreign.id, row.id, descriptor.mission!.goal, descriptor.mission!.status);
    refs.foreignProjectId = row.id;
    refs.projectId = row.id;
    refs.missionId = m.id;
    refs.actorCanAccessProject = false;
    return refs;
  }
  if (!descriptor.projectTitle) return refs;
  const row = await project(owner.id, descriptor.projectTitle, descriptor.goal, descriptor.scenario);
  refs.projectId = row.id;
  const captures = [];
  for (const text of descriptor.captures) captures.push(await capture(row.id, text));
  const sources: Source[] = [];
  for (const item of captures) {
    const source = await readProjectMaterial(row.id, "capture:" + item.id);
    if (source) sources.push(source);
  }
  refs.sources = sources;
  if (descriptor.connection) {
    const connection = await db.sourceConnection.create({ data: { projectId: row.id, ownerUserId: owner.id, provider: "GITHUB", repo: "example/release", ref: "main", signalKind: "COMMITS_AND_CI", status: "ACTIVE" } });
    await db.externalSignal.create({ data: { connectionId: connection.id, projectId: row.id, ownerUserId: owner.id, sha: "a1b2c3", kind: "CI", title: "CI 失败", authorName: "fixture", url: "https://example.invalid/ci", status: "ADOPTED" } });
    refs.connectionIds = [connection.id];
  }
  if (descriptor.mission) {
    const researchScope = descriptor.publicResearch
      ? { enabled: true, academicMetadata: false, topic: "公开评估方法", publicTerms: ["公开评估方法"], allowedCategories: ["PUBLIC_TOPIC"], excludedTerms: [], allowedHosts: ["example.org"] }
      : {};
    const m = await mission(owner.id, row.id, descriptor.mission.goal, descriptor.mission.status, descriptor.mission.waitFor, refs.connectionIds, researchScope);
    refs.missionId = m.id;
    if (descriptor.evidence !== "NONE") await priorRead(m.id, sources);
    if (descriptor.output) {
      const out = await outputVersion(m.id, sources);
      refs.outputId = out.id;
      if (descriptor.artifact) {
        const artifact = await adoptedArtifact(owner.id, row.id, m.id, out, sources[0]);
        refs.artifactId = artifact.id;
        refs.artifactReceiptCount = 1;
      }
    }
  }
  return refs;
}

/** Build the real router input for a materialized fixture. Only persisted records are read. */
export async function routingInputFor(refs: FixtureRefs, message: string, event = "USER_MESSAGE"): Promise<SkillRoutingInput> {
  if (refs.missionId) {
    const missionRow = await db.agentMission.findUniqueOrThrow({ where: { id: refs.missionId } });
    const input = await buildRoutingInput(db, missionRow, { message, candidates: refs.candidateMissions });
    if (!refs.actorCanAccessProject) {
      return { ...input, permission: { ...input.permission, ownerMatches: false, projectAccessible: false } };
    }
    return { ...input, event: event as SkillRoutingInput["event"] };
  }
  return {
    message, event: event as SkillRoutingInput["event"], mission: null,
    candidateMissions: refs.candidateMissions,
    project: refs.projectId ? { id: refs.projectId, title: "评测项目", sourceCount: refs.sources.length, readableSources: refs.sources.length } : null,
    permission: { ownerMatches: true, projectAccessible: true, hasReadableMaterial: refs.sources.length > 0,
      publicResearch: false, publicTerms: [], connectedSourceIds: refs.connectionIds, allowedToolNames: ["read_project_material", "save_mission_output"], externalApprovalRequired: false },
    activity: { evidence: refs.evidence, latestOutputId: refs.outputId, outputCount: refs.outputId ? 1 : 0, newSourceEvents: 0, changedSinceLastRun: false },
  };
}

export function fixtureIds(): string[] {
  return Object.keys(DESCRIPTORS);
}

export function datasetFixtureIds(): string[] {
  const file = path.resolve("docs/v2/evaluation/skill-routing.v1.json");
  const dataset = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")) as { fixtures: Record<string, unknown> };
  return Object.keys(dataset.fixtures);
}
