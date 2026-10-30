import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-ct8-"));
  const file = path.join(directory, "ct8.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", PROJECT_EXPERIENCE_ENABLED: "true", FOCUS_AGENT_ENABLED: "true", LLM_MODE: "mock", SEMANTIC_MEMORY_ENABLED: "false" });
  const sql = new Database(file);
  for (const dir of fs.readdirSync("prisma/migrations").sort()) {
    const migration = path.join("prisma/migrations", dir, "migration.sql");
    if (fs.existsSync(migration)) sql.exec(fs.readFileSync(migration, "utf8"));
  }
  sql.close();
  return { directory };
});

import fs from "node:fs";
import { db } from "@/lib/db";
import { createMission } from "@/lib/mission/missionService";
import { buildContext } from "@/lib/mission/contextBuilder";
import { runMissionSlice } from "@/lib/mission/runner";
import { projectTools } from "@/lib/mission/tools";
import { json } from "@/lib/mission/contracts";
import { buildTrajectoryIndex } from "@/lib/experience/trajectoryIndex";
import { extractCandidates, syncExperiences } from "@/lib/experience/extract";
import { resolveExperience, recordModelDecision, assertExperienceReadSet, currentMissionFacets } from "@/lib/experience/injection";
import { resolveConversationExperience, recordConversationExperience } from "@/lib/experience/injection";
import { readExperiences, actOnExperience, refreshExperiences, listExperiences } from "@/lib/experience/service";
import { facetsFromMission, facetsFromConversation, applicabilityOf, conditionKeyOf } from "@/lib/experience/conditions";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { submitDirective } from "@/lib/continuity/directiveService";

let userId = "", otherUserId = "", projectId = "", targetProjectId = "", otherProjectId = "";
beforeAll(async () => {
  userId = (await db.user.create({ data: { username: `ct8-${crypto.randomUUID()}`, displayName: "CT8", passwordHash: "unused" } })).id;
  otherUserId = (await db.user.create({ data: { username: `ct8-other-${crypto.randomUUID()}`, displayName: "他人", passwordHash: "unused" } })).id;
  projectId = (await db.project.create({ data: { title: "CT8 项目", description: "fixture", goal: "整理项目资料并形成报告", scenario: "RESEARCH" } })).id;
  targetProjectId = (await db.project.create({ data: { title: "迁移目标", description: "fixture", goal: "整理项目资料并形成报告", scenario: "RESEARCH" } })).id;
  otherProjectId = (await db.project.create({ data: { title: "他人项目", description: "fixture", goal: "他人目标", scenario: "RESEARCH" } })).id;
  await db.projectMembership.create({ data: { userId, projectId, role: "OWNER" } });
  await db.projectMembership.create({ data: { userId, projectId: targetProjectId, role: "OWNER" } });
  await db.projectMembership.create({ data: { userId: otherUserId, projectId: otherProjectId, role: "OWNER" } });
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.directory, { recursive: true, force: true }); });

type SeedStep = { tool: string; status?: string; version?: string; protocol?: number | null; input?: Record<string, unknown>; failure?: Record<string, unknown>; sandboxReceipt?: string };

async function seedMission(owner: string, project: string, spec: {
  goal: string; tools: SeedStep[]; output?: { content?: unknown; adopt?: boolean; sourceCaptureId?: string };
  action?: { status: "TODO" | "DOING" | "DONE" | "CANCELLED"; resultCard?: boolean };
  constraints?: Record<string, unknown>; status?: string; sourceCaptureId?: string;
}) {
  const m = await createMission(owner, { projectId: project, requestId: crypto.randomUUID(), goal: spec.goal,
    ...(spec.constraints ? { missionConstraints: spec.constraints } : {}), llmContextApproved: true });
  const capture = spec.sourceCaptureId
    ? await db.capture.findUniqueOrThrow({ where: { id: spec.sourceCaptureId } })
    : await db.capture.create({ data: { projectId: project, rawText: `CT8 原记录 ${crypto.randomUUID()}`, sourceType: "fixture" } });
  const source = { id: `capture:${capture.id}`, kind: "PROJECT", entityType: "CAPTURE", revision: "v1", hash: "h1", text: capture.rawText, observedAt: new Date().toISOString() };
  let ordinal = 0;
  for (const step of spec.tools) {
    ordinal += 1;
    await db.agentMissionStep.create({ data: {
      missionId: m.id, ordinal, planRevision: 1, toolName: step.tool, toolVersion: step.version ?? "1",
      status: step.status ?? "SUCCEEDED", canonicalInputJson: json(step.input ?? {}), inputHash: `h-${crypto.randomUUID()}`,
      readSetJson: json([source]), resultJson: json({ data: {}, sources: [source] }),
      ...(step.protocol === null ? {} : { protocolJson: json({ protocol: "JSON_CHOICE", schemaVersion: step.protocol ?? 1 }) }),
      ...(step.failure ? { failureJson: json(step.failure) } : {}),
      ...(step.sandboxReceipt ? { protocolJson: json({ protocol: "JSON_CHOICE", schemaVersion: 1, sandboxJob: { phase: "SETTLED", receiptHash: step.sandboxReceipt } }),
        verificationJson: json({ exitCode: 0, receiptHash: step.sandboxReceipt }) } : {}),
    } });
  }
  if (spec.output) {
    const output = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "REPORT_DRAFT",
      contentJson: json(spec.output.content ?? { blocks: [] }), sourceRefsJson: json([source]), claimChecksJson: json([]) } });
    if (spec.output.adopt) {
      const artifact = await db.generatedArtifact.create({ data: { projectId: project, artifactType: "weekly_report", content: "adopted" } });
      await db.missionArtifactReceipt.create({ data: { projectId: project, missionId: m.id, outputId: output.id, outputRevision: 1,
        outputHash: "x", artifactId: artifact.id, artifactType: "weekly_report", sourceManifestJson: json({}), blockMapJson: json({}),
        verificationSnapshotJson: json({}), createdByUserId: owner, requestId: `r-${crypto.randomUUID()}`, payloadHash: "x" } });
    }
  }
  if (spec.action) {
    const effectKey = `mission:${m.id}:step:1`;
    let resultCardId: string | null = null;
    if (spec.action.resultCard) {
      const cap = await db.capture.create({ data: { projectId: project, rawText: "行动复盘", sourceType: "Agent行动回执" } });
      resultCardId = (await db.knowledgeCard.create({ data: { projectId: project, captureId: cap.id, type: "reflection", title: "复盘",
        summary: "复盘", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } })).id;
    }
    const action = await db.actionItem.create({ data: { projectId: project, title: "行动", dedupeKey: effectKey, status: spec.action.status, resultCardId } });
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: m.id, ordinal: 1 } });
    await db.agentMissionStep.update({ where: { id: step.id }, data: { effectKey, resultJson: json({ data: { actionId: action.id }, sources: [source] }) } });
  }
  if (spec.status) await db.agentMission.update({ where: { id: m.id }, data: { status: spec.status } });
  return m;
}

async function workflowExperience() {
  const rows = await db.agentExperience.findMany({ where: { projectId, ownerUserId: userId, kind: "WORKFLOW" } });
  return rows.find(r => (r.applicabilityJson as { tools?: string[] }).tools?.includes("read_project_material") && r.supportCount >= 2)!;
}

describe("CT-8 结果分层与条件化提炼", () => {
  it("工程成功、采用、行动回执分开；未采用不是反例，明确负结果才计反例", async () => {
    const base = { goal: "整理资料形成报告", tools: [{ tool: "inspect_project" }, { tool: "read_project_material" }], output: { adopt: true } };
    await seedMission(userId, projectId, { ...base, status: "SUCCEEDED", action: { status: "DONE", resultCard: true } });
    await seedMission(userId, projectId, { ...base, status: "SUCCEEDED", action: { status: "CANCELLED", resultCard: true } });
    await seedMission(userId, projectId, { goal: "整理资料形成报告", tools: base.tools, output: {}, status: "SUCCEEDED" });
    await syncExperiences(userId, projectId);
    const row = await db.agentExperience.findFirstOrThrow({ where: { projectId, ownerUserId: userId, kind: "WORKFLOW" } });
    expect(row.supportCount).toBe(1);
    expect(row.counterCount).toBe(1);
    const evidence = row.evidenceJson as { samples: Array<{ classification: string; resultLabels: { adopted: boolean; explicitNegative: number } }> };
    expect(evidence.samples.some(s => s.classification === "UNKNOWN" && !s.resultLabels.adopted)).toBe(true);
    expect(evidence.samples.some(s => s.classification === "COUNTER")).toBe(true);
    const index = await buildTrajectoryIndex(userId, projectId);
    expect(index.entries.filter(e => e.resultLabels.adopted).length).toBe(2);
    expect(index.entries.filter(e => e.resultLabels.independentMeasurement).length).toBe(0);
  });

  it("同工具序列在资源限制条件下拆成不同经验，不自动合并", async () => {
    for (const limit of ["GPU:24GB", "GPU:24GB", "GPU:40GB"]) {
      await seedMission(userId, projectId, { goal: "整理资料形成报告", constraints: { resourceLimits: [limit] },
        tools: [{ tool: "inspect_action" }, { tool: "search_memory" }], output: { adopt: true }, status: "SUCCEEDED",
        action: { status: "DONE", resultCard: true } });
    }
    const index = await buildTrajectoryIndex(userId, projectId);
    const candidates = extractCandidates(index);
    const relevant = candidates.filter(c => c.applicability.tools.includes("search_memory"));
    expect(relevant.length).toBe(2);
    expect(new Set(relevant.map(c => c.conditionKey)).size).toBe(2);
  });

  it("同 run 多份摘要/复制 Mission 不虚增独立支持；固定核算回执才计独立实测", async () => {
    const content = { blocks: [{ blockId: "same", text: "同一结论", kind: "INFERENCE", sourceIds: [] }] };
    const shared = await db.capture.create({ data: { projectId, rawText: "同一来源", sourceType: "fixture" } });
    for (const receipt of ["r1", "r2"]) {
      await seedMission(userId, projectId, { goal: "实验指标对比", status: "SUCCEEDED", sourceCaptureId: shared.id,
        tools: [{ tool: "propose_metric_verification", sandboxReceipt: receipt,
          input: { mapping: { dataset: "DS", split: "train", unit: "acc", environment: "local" }, metric: "acc" } }],
        output: { content, adopt: true } });
    }
    await syncExperiences(userId, projectId);
    const row = (await db.agentExperience.findMany({ where: { projectId, ownerUserId: userId, kind: "WORKFLOW" } })).find(r => (r.applicabilityJson as { tools?: string[] }).tools?.[0] === "propose_metric_verification")!;
    expect(row.supportCount).toBe(1);
    expect((row.evidenceJson as { samples: Array<{ counted: boolean }> }).samples.filter(s => !s.counted).length).toBe(1);
    expect(row.status).toBe("CANDIDATE");
  });

  it("失败原因绑定具体 Step，后来的成功不当作原因已解决；不复用全局最后错误", async () => {
    const m = await seedMission(userId, projectId, { goal: "失败原因归因", status: "SUCCEEDED",
      tools: [{ tool: "inspect_project", status: "FAILED", failure: { code: "MODEL_PROTOCOL_ERROR", reason: "TRUNCATED_JSON" } },
        { tool: "inspect_project" },
        { tool: "read_project_material", status: "FAILED", failure: { code: "INVALID_TOOL_ARGUMENTS", reason: "INVALID_TOOL_ARGUMENTS" } }],
      output: { adopt: true } });
    await db.agentMissionEvent.create({ data: { missionId: m.id, seq: 9, type: "MODEL_PROTOCOL_ERROR", payloadJson: json({ code: "MODEL_PROTOCOL_ERROR", diagnostic: { reason: "TRUNCATED_JSON" } }) } });
    const index = await buildTrajectoryIndex(userId, projectId);
    const entry = index.entries.find(e => e.missionId === m.id)!;
    expect(entry.guardrailObservations.map(g => [g.tool, g.reasonClass])).toEqual([
      ["inspect_project", "TRUNCATED_JSON"], ["read_project_material", "INVALID_TOOL_ARGUMENTS"]]);
    expect(entry.guardrailObservations.every(g => g.repairVerified === false)).toBe(true);
    const guard = extractCandidates(index).filter(c => c.kind === "GUARDRAIL" && c.samples.some(s => s.missionId === m.id));
    expect(guard.map(c => c.pattern.reasonClass)).toEqual(["TRUNCATED_JSON", "INVALID_TOOL_ARGUMENTS"]);
    expect(guard.every(c => c.samples.some(s => s.reason === "FAILURE_OBSERVED_RETRY_UNVERIFIED" || s.reason === "FAILURE_OBSERVED_NOT_RETRIED"))).toBe(true);
  });
});

describe("CT-8 两条 Agent 消费路径与失效边界", () => {
  it("Mission ContextBuilder 只注入条件 MATCH + ACTIVE 经验，记录模型决策与原结果链", async () => {
    for (let i = 0; i < 2; i++) {
      await seedMission(userId, projectId, { goal: "整理资料形成报告", status: "SUCCEEDED",
        tools: [{ tool: "inspect_project" }, { tool: "read_project_material" }], output: { adopt: true }, action: { status: "DONE", resultCard: true } });
    }
    await syncExperiences(userId, projectId);
    const row = await workflowExperience();
    if (row.status !== "ACTIVE") {
      const current = await workflowExperience();
      if (current.status === "SHADOW") await actOnExperience(userId, projectId, current.id, { action: "ACTIVATE", requestId: crypto.randomUUID(), expectedVersion: current.version });
    }
    const active = await workflowExperience();
    expect(active.status).toBe("ACTIVE");
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "整理资料形成报告", llmContextApproved: true });
    const ctx = await buildContext(m);
    const parsed = JSON.parse(ctx) as { experienceAdvisories: Array<{ id: string; conditions: string[]; unknownConditions: string[] }>; experienceReadSet: Array<{ experienceId: string }> };
    expect(parsed.experienceAdvisories.map(a => a.id)).toContain(active.id);
    expect(parsed.experienceReadSet.map(r => r.experienceId)).toContain(active.id);
    expect(parsed.experienceAdvisories[0].conditions.length).toBeGreaterThan(0);
    const run = await runMissionSlice({ id: m.id, tools: projectTools, provider: async (context) => {
      expect(JSON.parse(context).experienceAdvisories.length).toBeGreaterThan(0);
      return { choice: { kind: "tool", tool: "inspect_project", args: {}, summary: "按经验先核对项目",
        experienceUse: [{ experienceId: active.id, disposition: "ADOPT" }] }, provider: "SCRIPTED_CT8", model: "scripted",
        protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } };
    } });
    expect(run).toBe(true);
    expect(await db.agentExperienceUse.findFirst({ where: { experienceId: active.id, missionId: m.id, stage: "MODEL_DECISION" } })).toMatchObject({ actorKind: "MISSION" });
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: m.id } });
    expect(((step.protocolJson as { experienceReadSet?: Array<{ experienceId: string }> }).experienceReadSet ?? []).map(r => r.experienceId)).toContain(active.id);
    await actOnExperience(userId, projectId, active.id, { action: "REVOKE", requestId: crypto.randomUUID(), expectedVersion: active.version });
    await expect(assertExperienceReadSet(userId, (step.protocolJson as { experienceReadSet: unknown }).experienceReadSet)).rejects.toMatchObject({ code: "COGNITIVE_RECOORDINATE" });
    const after = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: m.id } }))) as { experienceAdvisories: unknown[] };
    expect(after.experienceAdvisories).toEqual([]);
  });

  it("Conversation/Focus 共用条件匹配器，记录注入与模型决策；不冒用 Mission 数据集条件", async () => {
    const source = await db.capture.create({ data: { projectId, rawText: "会话经验来源", sourceType: "fixture" } });
    const facets = facetsFromMission(await db.agentMission.findFirstOrThrow({ where: { projectId } }),
      [{ toolName: "inspect_project", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, protocolJson: { schemaVersion: 1 } },
        { toolName: "read_project_material", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, protocolJson: { schemaVersion: 1 } }], "RESEARCH");
    const app = applicabilityOf({ facets, conditions: ["同类报告任务"], tools: ["inspect_project", "read_project_material"], notApplicableWhen: ["数据集条件不同"] });
    const row = await db.agentExperience.create({ data: { projectId, ownerUserId: userId, kind: "WORKFLOW", patternHash: "conv-pattern",
      conditionKey: "conv-condition", title: "会话可用的方法", statement: "先核对项目再读材料。这是建议，不改变权限。",
      applicabilityJson: json(app), toolVersionsJson: json({ inspect_project: "1", read_project_material: "1" }),
      protocolVersionsJson: json([1]), status: "ACTIVE", sampleMissionIdsJson: json([(await db.agentMission.findFirstOrThrow({ where: { projectId } })).id]),
      supportCount: 2, counterCount: 0 } });
    const convFacets = facetsFromConversation({ goal: "整理项目资料并形成报告", scenario: "RESEARCH", constraints: [],
      tools: [{ name: "inspect_project", version: "1" }, { name: "read_project_material", version: "1" }] });
    const resolved = await resolveConversationExperience({ ownerUserId: userId, projectId, conversationId: "conv-fixture", turnId: "turn-fixture",
      facets: convFacets, usedTools: [{ name: "inspect_project", version: "1" }, { name: "read_project_material", version: "1" }], protocolSchemaVersion: 1 });
    expect(resolved.decisions.some(d => "advisory" in d && d.experienceId === row.id)).toBe(true);
    await recordConversationExperience({ projectId, conversationId: "conv-fixture", turnId: "turn-fixture" }, resolved.decisions, "ctx");
    await recordModelDecision({ conversationId: "conv-fixture", turnId: "turn-fixture", experienceId: row.id, disposition: "ADOPT",
      version: row.version, contentHash: resolved.readSet.find(r => r.experienceId === row.id)!.contentHash, contextHash: "ctx" });
    expect(await db.agentExperienceUse.count({ where: { experienceId: row.id, conversationId: "conv-fixture", stage: "INJECTED" } })).toBe(1);
    expect(await db.agentExperienceUse.count({ where: { experienceId: row.id, conversationId: "conv-fixture", stage: "MODEL_DECISION" } })).toBe(1);
    const experimentFacets = facetsFromConversation({ goal: "实验指标对比", scenario: "RESEARCH", constraints: [],
      tools: [{ name: "inspect_experiment_metrics", version: "1" }] });
    expect(conditionKeyOf(experimentFacets)).not.toBe(conditionKeyOf(convFacets));
    expect(source.id).toBeTruthy();
  });

  it("来源抑制、时间边界、撤销和条件不匹配都停止新注入", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "整理资料形成报告" });
    const active = await db.agentExperience.findFirstOrThrow({ where: { projectId, ownerUserId: userId, status: "ACTIVE" } });
    await db.agentExperience.update({ where: { id: active.id }, data: { validUntil: new Date(Date.now() - 1000) } });
    const expired = await resolveExperience(m, Object.entries(projectTools).map(([name, t]) => ({ name, version: t.version ?? "1" })), 1);
    expect(expired.decisions.some(d => !("advisory" in d) && d.suppressed.experienceId === active.id && d.suppressed.reason === "EXPIRED")).toBe(true);
    await db.agentExperience.update({ where: { id: active.id }, data: { validUntil: null } });
    const restricted = (await db.agentExperience.findMany({ where: { projectId, ownerUserId: userId } }))
      .find(r => (r.applicabilityJson as { facets?: { resourceLimits?: string[] } }).facets?.resourceLimits?.includes("GPU:24GB"))!;
    await db.agentExperience.update({ where: { id: restricted.id }, data: { status: "ACTIVE" } });
    const limited = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "整理资料形成报告",
      missionConstraints: { resourceLimits: ["GPU:40GB"] } });
    const mismatch = await resolveExperience(limited, Object.entries(projectTools).map(([name, t]) => ({ name, version: t.version ?? "1" })), 1);
    expect(mismatch.decisions.some(d => !("advisory" in d) && d.suppressed.experienceId === restricted.id && d.suppressed.matchState === "MISMATCH")).toBe(true);
    await db.agentExperience.update({ where: { id: restricted.id }, data: { status: "CANDIDATE" } });

    const sp = await db.project.create({ data: { title: "抑制项目", description: "fixture", goal: "整理资料形成报告", scenario: "RESEARCH" } });
    await db.projectMembership.create({ data: { userId, projectId: sp.id, role: "OWNER" } });
    const capture = await db.capture.create({ data: { projectId: sp.id, rawText: "可抑制来源", sourceType: "fixture" } });
    for (let i = 0; i < 2; i++) await seedMission(userId, sp.id, { goal: "整理资料形成报告", status: "SUCCEEDED", sourceCaptureId: capture.id,
      tools: [{ tool: "inspect_project" }, { tool: "read_project_material" }], output: { adopt: true }, action: { status: "DONE", resultCard: true } });
    await syncExperiences(userId, sp.id);
    const row = await db.agentExperience.findFirstOrThrow({ where: { projectId: sp.id, ownerUserId: userId, status: "SHADOW" } });
    await actOnExperience(userId, sp.id, row.id, { action: "ACTIVATE", requestId: crypto.randomUUID(), expectedVersion: row.version });
    const actor = { userId, sessionId: (await createSession(userId)).session.id };
    const conv = await createConversation(actor, { requestId: crypto.randomUUID(), scope: "PROJECT", projectId: sp.id });
    await submitDirective(actor, conv.id, { commandId: "suppress-ct8", expectedSeq: 0, scope: { projectId: sp.id }, operation: "SUPPRESS_USE", sourceIds: ["capture:" + capture.id] });
    await syncExperiences(userId, sp.id);
    const after = await db.agentExperience.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.supportCount).toBe(0);
    expect(after.status).toBe("ACTIVE");
    const blocked = await resolveExperience(await createMission(userId, { projectId: sp.id, requestId: crypto.randomUUID(), goal: "整理资料形成报告" }),
      [{ name: "inspect_project", version: "1" }, { name: "read_project_material", version: "1" }], 1);
    expect(blocked.decisions.some(d => !("advisory" in d) && d.suppressed.experienceId === row.id && ["ROOT_SUPPRESSED", "SOURCE_SUPPRESSED"].includes(d.suppressed.reason.split(":")[0]))).toBe(true);
  });
});

describe("CT-8 管理、幂等、迁移与有界", () => {
  it("显式整理而非 GET 隐式同步；重复整理零重复样本", async () => {
    const before = await readExperiences(userId, projectId);
    expect(before.experiences.length).toBeGreaterThan(0);
    const first = await refreshExperiences(userId, projectId, { action: "REFRESH", requestId: crypto.randomUUID() });
    expect(first.synced!.changed).toBe(0);
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "无新增结果的任务" });
    const countBefore = await db.agentExperience.count({ where: { projectId, ownerUserId: userId } });
    await listExperiences(userId, projectId);
    expect(await db.agentExperience.count({ where: { projectId, ownerUserId: userId } })).toBe(countBefore);
    expect(m.id).toBeTruthy();
  });

  it("激活/撤销 CAS、requestId 幂等与旧客户端兼容", async () => {
    const sampleMission = await db.agentMission.findFirstOrThrow({ where: { projectId } });
    const candidate = await db.agentExperience.create({ data: { projectId, ownerUserId: userId, kind: "WORKFLOW", patternHash: `cas-${crypto.randomUUID()}`,
      conditionKey: `cas-${crypto.randomUUID()}`, title: "CAS 方法", statement: "建议不改变权限", status: "SHADOW", supportCount: 2,
      sampleMissionIdsJson: json([sampleMission.id]),
      applicabilityJson: json(applicabilityOf({ facets: facetsFromMission(sampleMission,
        [{ toolName: "inspect_project", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, protocolJson: { schemaVersion: 1 } }], "RESEARCH"),
        conditions: ["同类任务"], tools: ["inspect_project"] })),
      toolVersionsJson: json({ inspect_project: "1" }), protocolVersionsJson: json([1]) } });
    const requestId = crypto.randomUUID();
    const first = await actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId, expectedVersion: candidate.version });
    const replay = await actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId, expectedVersion: candidate.version });
    expect(replay).toEqual(first);
    await expect(actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId: crypto.randomUUID(), expectedVersion: candidate.version }))
      .rejects.toMatchObject({ code: "EXPERIENCE_CHANGED" });
    await expect(actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId, expectedVersion: candidate.version + 99 }))
      .rejects.toMatchObject({ code: "REQUEST_ID_REUSED" });
    const revoke = await actOnExperience(userId, projectId, candidate.id, { action: "REVOKE", requestId: crypto.randomUUID(), expectedVersion: first.version });
    expect(revoke.status).toBe("REVOKED");
    const legacy = await actOnExperience(userId, projectId, candidate.id, { action: "REVOKE", requestId: crypto.randomUUID() });
    expect(legacy.status).toBe("REVOKED");
  });

  it("跨项目迁移只生成待重验 CANDIDATE，不继承 ACTIVE 或私人样本；无权限拒绝", async () => {
    const source = await db.agentExperience.create({ data: { projectId, ownerUserId: userId, kind: "WORKFLOW", patternHash: `mig-${crypto.randomUUID()}`,
      conditionKey: `mig-${crypto.randomUUID()}`, title: "迁移方法", statement: "建议", status: "ACTIVE", supportCount: 2,
      sampleMissionIdsJson: json([(await db.agentMission.findFirstOrThrow({ where: { projectId } })).id]),
      applicabilityJson: json(applicabilityOf({ facets: facetsFromMission(await db.agentMission.findFirstOrThrow({ where: { projectId } }),
        [{ toolName: "inspect_project", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, protocolJson: { schemaVersion: 1 } }], "RESEARCH"),
        conditions: ["同类任务"], tools: ["inspect_project"] })),
      toolVersionsJson: json({ inspect_project: "1" }), protocolVersionsJson: json([1]) } });
    const migrated = await actOnExperience(userId, projectId, source.id, { action: "MIGRATE", requestId: crypto.randomUUID(), expectedVersion: source.version, targetProjectId }) as { targetStatus: string; targetExperienceId?: string };
    expect(migrated.targetStatus).toBe("CANDIDATE");
    const target = await db.agentExperience.findUniqueOrThrow({ where: { id: migrated.targetExperienceId! } });
    expect(target).toMatchObject({ status: "CANDIDATE", supportCount: 0, counterCount: 0 });
    expect(target.sampleMissionIdsJson).toEqual([]);
    expect((target.originJson as { sourceProjectId?: string }).sourceProjectId).toBe(projectId);
    await expect(actOnExperience(otherUserId, projectId, source.id, { action: "MIGRATE", requestId: crypto.randomUUID(), targetProjectId: otherProjectId }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("超过注入上限时显式裁剪，仍可按原结果核对", async () => {
    const bp = await db.project.create({ data: { title: "有界项目", description: "fixture", goal: "整理资料形成报告", scenario: "RESEARCH" } });
    await db.projectMembership.create({ data: { userId, projectId: bp.id, role: "OWNER" } });
    const sampleMission = await seedMission(userId, bp.id, { goal: "整理资料形成报告", status: "SUCCEEDED",
      tools: [{ tool: "inspect_project" }, { tool: "read_project_material" }], output: { adopt: true }, action: { status: "DONE", resultCard: true } });
    const m = await createMission(userId, { projectId: bp.id, requestId: crypto.randomUUID(), goal: "整理资料形成报告" });
    const facets = await currentMissionFacets(m, Object.entries(projectTools).map(([name, t]) => ({ name, version: t.version ?? "1" })));
    const app = applicabilityOf({ facets, conditions: ["同类任务"], tools: ["inspect_project", "read_project_material"] });
    for (let i = 0; i < 5; i++) {
      await db.agentExperience.create({ data: { projectId: bp.id, ownerUserId: userId, kind: "WORKFLOW", patternHash: `bounded-${i}-${crypto.randomUUID()}`,
        conditionKey: `bounded-${i}-${crypto.randomUUID()}`, title: `有界方法 ${i}`, statement: "建议不改变权限", status: "ACTIVE",
        supportCount: 2, sampleMissionIdsJson: json([sampleMission.id]), applicabilityJson: json(app),
        toolVersionsJson: json({ inspect_project: "1", read_project_material: "1" }), protocolVersionsJson: json([1]), originJson: json({ missionId: sampleMission.id }) } });
    }
    const resolved = await resolveExperience(m, Object.entries(projectTools).map(([name, t]) => ({ name, version: t.version ?? "1" })), 1);
    const injected = resolved.decisions.filter(d => "advisory" in d);
    expect(injected.length).toBe(3);
    expect(resolved.readSet.length).toBe(3);
    expect(resolved.decisions.some(d => !("advisory" in d) && d.suppressed.reason === "CONTEXT_BUDGET")).toBe(true);
    expect(injected.every(d => "advisory" in d && d.advisory.originMissionId === sampleMission.id)).toBe(true);
  });
});
