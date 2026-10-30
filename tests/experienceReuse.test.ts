import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-experience-"));
  const file = path.join(directory, "experience.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", PROJECT_EXPERIENCE_ENABLED: "true", FOCUS_AGENT_ENABLED: "true" });
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
import { buildTrajectoryIndex } from "@/lib/experience/trajectoryIndex";
import { extractCandidates, syncExperiences } from "@/lib/experience/extract";
import { injectionDecisions, suggestionsForMission } from "@/lib/experience/injection";
import { listExperiences, actOnExperience, readExperiences, refreshExperiences } from "@/lib/experience/service";
import { projectTools } from "@/lib/mission/tools";
import { json } from "@/lib/mission/contracts";

let userId: string, otherUserId: string, projectId: string, otherProjectId: string;
beforeAll(async () => {
  userId = (await db.user.create({ data: { username: `exp-${crypto.randomUUID()}`, displayName: "经验隔离测试", passwordHash: "unused" } })).id;
  otherUserId = (await db.user.create({ data: { username: `exp-other-${crypto.randomUUID()}`, displayName: "其他用户", passwordHash: "unused" } })).id;
  projectId = (await db.project.create({ data: { title: "经验项目", description: "fixture", goal: "整理项目资料", scenario: "RESEARCH" } })).id;
  otherProjectId = (await db.project.create({ data: { title: "他人项目", description: "fixture", goal: "他人目标", scenario: "RESEARCH" } })).id;
  await db.projectMembership.create({ data: { userId, projectId, role: "OWNER" } });
  await db.projectMembership.create({ data: { userId: otherUserId, projectId: otherProjectId, role: "OWNER" } });
});
afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.directory, { recursive: true, force: true }); });

type StepSpec = { tool: string; status?: string; version?: string; protocol?: number | null; failure?: Record<string, unknown> };

/** 构造轨迹：含真实来源、采用回执与行动结果链；只验证提炼/注入规则。 */
async function seedMission(owner: string, project: string, spec: {
  goal: string; status?: string; steps: StepSpec[]; output?: boolean; adoption?: boolean;
  action?: { status: string; resultCard?: boolean };
}) {
  const m = await createMission(owner, { projectId: project, requestId: crypto.randomUUID(), goal: spec.goal });
  const capture = await db.capture.create({ data: { projectId: project, rawText: "经验来源 " + crypto.randomUUID(), sourceType: "fixture" } });
  const source = { id: `capture:${capture.id}`, kind: "PROJECT", entityType: "CAPTURE", revision: "v1", hash: "h1", text: capture.rawText, observedAt: new Date().toISOString() };
  let ordinal = 0;
  for (const step of spec.steps) {
    ordinal += 1;
    await db.agentMissionStep.create({ data: {
      missionId: m.id, ordinal, planRevision: 1, toolName: step.tool, toolVersion: step.version ?? "1",
      status: step.status ?? "SUCCEEDED", canonicalInputJson: {}, inputHash: `h-${crypto.randomUUID()}`,
      readSetJson: json([source]), resultJson: json({ data: {}, sources: [source] }),
      ...(step.protocol === null ? {} : { protocolJson: json({ protocol: "JSON_CHOICE", schemaVersion: step.protocol ?? 1 }) }),
      ...(step.failure ? { failureJson: json(step.failure) } : {}),
    } });
  }
  if (spec.output) {
    const output = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "REPORT_DRAFT", contentJson: json({ blocks: [] }), sourceRefsJson: json([source]), claimChecksJson: json([]) } });
    if (spec.adoption) {
      const artifact = await db.generatedArtifact.create({ data: { projectId: project, artifactType: "weekly_report", content: "adopted" } });
      await db.missionArtifactReceipt.create({ data: { projectId: project, missionId: m.id, outputId: output.id, outputRevision: 1, outputHash: "x", artifactId: artifact.id, artifactType: "weekly_report", sourceManifestJson: json({}), blockMapJson: json({}), verificationSnapshotJson: json({}), createdByUserId: owner, requestId: `r-${crypto.randomUUID()}`, payloadHash: "x" } });
    }
  }
  if (spec.action) {
    const effectKey = `mission:${m.id}:step:1`;
    let resultCardId: string | null = null;
    if (spec.action.resultCard) {
      const cap = await db.capture.create({ data: { projectId: project, rawText: "行动复盘", sourceType: "Agent行动回执" } });
      resultCardId = (await db.knowledgeCard.create({ data: { projectId: project, captureId: cap.id, type: "reflection", title: "复盘", summary: "复盘", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } })).id;
    }
    const action = await db.actionItem.create({ data: { projectId: project, title: "行动", dedupeKey: effectKey, status: spec.action.status as never, resultCardId } });
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: m.id, ordinal: 1 } });
    await db.agentMissionStep.update({ where: { id: step.id }, data: { effectKey, resultJson: json({ data: { actionId: action.id }, sources: [source] }) } });
  }
  if (spec.status) await db.agentMission.update({ where: { id: m.id }, data: { status: spec.status } });
  return m;
}

async function experienceByTools(tools: string[], kind = "WORKFLOW") {
  const rows = await db.agentExperience.findMany({ where: { projectId, ownerUserId: userId, kind } });
  return rows.find(r => {
    const applicability = r.applicabilityJson as { tools?: string[] };
    return (applicability.tools ?? []).length === tools.length && (applicability.tools ?? []).every((t, i) => t === tools[i]);
  });
}

describe("P3-A 轨迹索引：四层结果标签互不混淆", () => {
  it("工程成功、用户采用、行动完成、用户自述效果分开记录", async () => {
    const engineeringOnly = await seedMission(userId, projectId, { goal: "只有工程成功", status: "SUCCEEDED", steps: [{ tool: "layer_a1" }, { tool: "layer_a2" }], output: true });
    const adopted = await seedMission(userId, projectId, { goal: "已采用成果", status: "SUCCEEDED", steps: [{ tool: "layer_b1" }, { tool: "layer_b2" }], output: true, adoption: true });
    const index = await buildTrajectoryIndex(userId, projectId);
    const entryOf = (id: string) => index.entries.find(e => e.missionId === id)!;
    expect(entryOf(engineeringOnly.id).resultLabels).toMatchObject({ engineeringCompleted: true, adopted: false, actionCompletedWithReceipt: false });
    expect(entryOf(adopted.id).resultLabels).toMatchObject({ engineeringCompleted: true, adopted: true, actionCompletedWithReceipt: false });
  });
  it("行动完成通过批准回执链读取，模拟行动不计入", async () => {
    const done = await seedMission(userId, projectId, { goal: "带行动完成", status: "SUCCEEDED", steps: [{ tool: "layer_c1" }], action: { status: "DONE", resultCard: true } });
    let index = await buildTrajectoryIndex(userId, projectId);
    const entry = index.entries.find(e => e.missionId === done.id)!;
    expect(entry.actionOutcomes).toEqual([{ actionId: expect.any(String), status: "DONE", resultCardId: expect.any(String) }]);
    expect(entry.resultLabels.actionCompletedWithReceipt).toBe(true);
    const actionId = entry.actionOutcomes[0].actionId;
    await db.actionItem.update({ where: { id: actionId }, data: { isSimulated: true } });
    index = await buildTrajectoryIndex(userId, projectId);
    expect(index.entries.find(e => e.missionId === done.id)!.actionOutcomes).toEqual([]);
    await db.actionItem.update({ where: { id: actionId }, data: { isSimulated: false } });
  });
  it("严格按用户与项目隔离，不读取他人轨迹", async () => {
    await seedMission(otherUserId, otherProjectId, { goal: "他人委托", status: "SUCCEEDED", steps: [{ tool: "layer_d1" }], output: true, adoption: true });
    const mine = await buildTrajectoryIndex(userId, projectId), other = await buildTrajectoryIndex(otherUserId, otherProjectId);
    expect(other.entries.some(e => mine.entries.some(m => m.missionId === e.missionId))).toBe(false);
    expect(mine.entries.some(e => e.goal === "他人委托")).toBe(false);
  });
});

describe("P3-A 候选提炼：独立样本与不自动激活", () => {
  it("两个独立委托、带行动回执后达到样本门槛进入 SHADOW，但绝不自动 ACTIVE", async () => {
    await seedMission(userId, projectId, { goal: "样本A", status: "SUCCEEDED", steps: [{ tool: "inspect_action" }, { tool: "search_memory" }], output: true, adoption: true, action: { status: "DONE", resultCard: true } });
    await seedMission(userId, projectId, { goal: "样本B", status: "SUCCEEDED", steps: [{ tool: "inspect_action" }, { tool: "search_memory" }], output: true, adoption: true, action: { status: "DONE", resultCard: true } });
    await syncExperiences(userId, projectId);
    const wf = (await experienceByTools(["inspect_action", "search_memory"]))!;
    expect(wf.status).toBe("SHADOW");
    expect(wf.supportCount).toBe(2);
    expect(await db.agentExperience.count({ where: { projectId, status: "ACTIVE" } })).toBe(0);
  });
  it("未采用保持 UNKNOWN，不成为反例；明确负结果才计反例", async () => {
    const base = { goal: "未采用对照", steps: [{ tool: "counter_1" }, { tool: "counter_2" }] as StepSpec[], status: "SUCCEEDED" };
    await seedMission(userId, projectId, { ...base, output: true, adoption: true, action: { status: "DONE", resultCard: true } });
    await seedMission(userId, projectId, { ...base, output: true });
    await seedMission(userId, projectId, { ...base, output: true, adoption: true, action: { status: "CANCELLED", resultCard: true } });
    await syncExperiences(userId, projectId);
    const wf = (await experienceByTools(["counter_1", "counter_2"]))!;
    expect(wf.supportCount).toBe(1);
    expect(wf.counterCount).toBe(1);
    const evidence = wf.evidenceJson as { samples: Array<{ classification: string }> };
    expect(evidence.samples.filter(s => s.classification === "UNKNOWN").length).toBeGreaterThanOrEqual(1);
  });
  it("失败原因绑定具体 Step，后来的成功不当作原因已解决", async () => {
    const repaired = await seedMission(userId, projectId, {
      goal: "协议失败后重试", status: "SUCCEEDED",
      steps: [{ tool: "guard_tool", status: "FAILED", failure: { code: "MODEL_PROTOCOL_ERROR", reason: "TRUNCATED_JSON" } }, { tool: "guard_tool" }, { tool: "guard_after" }],
      output: true, adoption: true,
    });
    const index = await buildTrajectoryIndex(userId, projectId);
    const entry = index.entries.find(e => e.missionId === repaired.id)!;
    expect(entry.guardrailObservations.map(g => [g.tool, g.reasonClass, g.repairVerified])).toEqual([["guard_tool", "TRUNCATED_JSON", false]]);
    const guard = extractCandidates(index).find(c => c.kind === "GUARDRAIL" && c.pattern.tool === "guard_tool")!;
    expect(guard.samples[0].reason).toBe("FAILURE_OBSERVED_RETRY_UNVERIFIED");
    expect(guard.supportCount).toBe(1);
    expect(guard.pattern).toEqual({ tool: "guard_tool", reasonClass: "TRUNCATED_JSON" });
  });
});

describe("P3-A 注入：条件匹配、建议性质、失效停注入", () => {
  it("只有用户激活后、条件匹配且来源有效的经验进入模型上下文，使用记录不重复", async () => {
    await syncExperiences(userId, projectId);
    const target = (await experienceByTools(["inspect_action", "search_memory"]))!;
    await actOnExperience(userId, projectId, target.id, { action: "ACTIVATE", requestId: crypto.randomUUID(), expectedVersion: target.version });
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "使用经验的新委托", llmContextApproved: true });
    const decisions = await injectionDecisions(m, Object.entries(projectTools).map(([name, tool]) => ({ name, version: tool.version ?? "1" })), 1);
    const injected = decisions.filter(d => "advisory" in d);
    expect(injected.length).toBeGreaterThanOrEqual(1);
    expect(injected[0]).toMatchObject({ advisory: { note: "项目内经验建议，不改变权限" } });
    const context = JSON.parse(await buildContext(m)) as { experienceAdvisories: Array<{ statement: string; conditions: string[] }> };
    expect(context.experienceAdvisories.length).toBeGreaterThan(0);
    expect(context.experienceAdvisories[0].statement).toContain("建议");
  });
  it("SHADOW 不进入模型上下文，但在委托详情可见", async () => {
    await seedMission(userId, projectId, { goal: "影子样本1", status: "SUCCEEDED", steps: [{ tool: "shadow_1" }, { tool: "shadow_2" }], output: true, adoption: true, action: { status: "DONE", resultCard: true } });
    await seedMission(userId, projectId, { goal: "影子样本2", status: "SUCCEEDED", steps: [{ tool: "shadow_1" }, { tool: "shadow_2" }], output: true, adoption: true, action: { status: "DONE", resultCard: true } });
    await syncExperiences(userId, projectId);
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "影子对照" });
    const suggestions = await suggestionsForMission(m);
    expect(suggestions.some(s => s.status === "SHADOW")).toBe(true);
    const context = JSON.parse(await buildContext(m)) as { experienceAdvisories: Array<{ id: string }> };
    expect(context.experienceAdvisories.every(a => suggestions.some(s => s.id === a.id && s.status === "ACTIVE"))).toBe(true);
  });
  it("工具版本或协议不兼容时停止新注入，历史使用记录保留", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "版本升级后" });
    const active = (await experienceByTools(["inspect_action", "search_memory"]))!;
    await db.agentExperience.update({ where: { id: active.id }, data: { toolVersionsJson: { inspect_action: "99" } } });
    const decisions = await injectionDecisions(m, [{ name: "inspect_action", version: "1" }, { name: "search_memory", version: "1" }], 1);
    expect(decisions.some(d => !("advisory" in d) && d.suppressed.experienceId === active.id && d.suppressed.reason.startsWith("TOOL_VERSION_MISMATCH"))).toBe(true);
    await db.agentExperience.update({ where: { id: active.id }, data: { toolVersionsJson: { inspect_action: "1", search_memory: "1" }, protocolVersionsJson: [99] } });
    try {
      const protocol = await injectionDecisions(m, [{ name: "inspect_action", version: "1" }, { name: "search_memory", version: "1" }], 1);
      expect(protocol.some(d => !("advisory" in d) && d.suppressed.experienceId === active.id && d.suppressed.reason.startsWith("PROTOCOL_VERSION_MISMATCH"))).toBe(true);
    } finally {
      await db.agentExperience.update({ where: { id: active.id }, data: { protocolVersionsJson: [1] } });
    }
    expect(await db.agentExperienceUse.count()).toBeGreaterThanOrEqual(0);
  });
});

describe("P3-A 管理接口：显式整理、状态机与越权", () => {
  it("GET 纯读不整理；显式整理幂等；CANDIDATE 不可激活；他人项目不可访问", async () => {
    const listed = await listExperiences(userId, projectId);
    expect(listed.enabled).toBe(true);
    expect(listed.trajectory!.engineeringSucceeded).toBeGreaterThan(0);
    const refreshed = await refreshExperiences(userId, projectId, { action: "REFRESH", requestId: crypto.randomUUID() });
    expect(refreshed.synced!.changed).toBe(0);
    const candidate = await db.agentExperience.findFirst({ where: { projectId, ownerUserId: userId, status: "CANDIDATE" } });
    if (candidate) await expect(actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    const shadow = await db.agentExperience.findFirstOrThrow({ where: { projectId, ownerUserId: userId, status: "SHADOW" } });
    const first = await actOnExperience(userId, projectId, shadow.id, { action: "ACTIVATE", requestId: crypto.randomUUID(), expectedVersion: shadow.version });
    const again = await actOnExperience(userId, projectId, shadow.id, { action: "ACTIVATE", requestId: crypto.randomUUID() });
    expect(first.status).toBe("ACTIVE"); expect(again.status).toBe("ACTIVE");
    await expect(actOnExperience(otherUserId, projectId, shadow.id, { action: "REVOKE", requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
  });
  it("开关关闭时不注入、GET 不隐式同步", async () => {
    process.env.PROJECT_EXPERIENCE_ENABLED = "0";
    try {
      const disabled = await readExperiences(userId, projectId);
      expect(disabled.enabled).toBe(false);
      const context = JSON.parse(await buildContext(await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "关闭后" }))) as { experienceAdvisories: unknown[] };
      expect(context.experienceAdvisories).toEqual([]);
    } finally { process.env.PROJECT_EXPERIENCE_ENABLED = "1"; }
  });
});

describe("P3-A 冻结任务对照探针（规则/mock，不宣称真实效果）", () => {
  it("结构化经验相对无经验：内容来自真实样本、不改变权限且成本有界", async () => {
    const frozen = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "冻结对照任务：整理资料并形成带来源草稿", llmContextApproved: true });
    process.env.PROJECT_EXPERIENCE_ENABLED = "0";
    let without: string;
    try { without = await buildContext(frozen); } finally { process.env.PROJECT_EXPERIENCE_ENABLED = "1"; }
    const withExperience = await buildContext(frozen);
    const a = JSON.parse(without) as { goal: string; successCriteria: unknown; constraints: unknown; experienceAdvisories: unknown[] };
    const b = JSON.parse(withExperience) as { goal: string; successCriteria: unknown; constraints: unknown; experienceAdvisories: Array<{ statement: string; conditions: string[]; note: string }>; manifest: { promptVersion: string } };
    expect(b.experienceAdvisories.length).toBeGreaterThan(0);
    for (const advisory of b.experienceAdvisories) {
      expect(advisory.statement).toContain("建议");
      expect(advisory.conditions.length).toBeGreaterThan(0);
      expect(advisory.note).toBe("项目内经验建议，不改变权限");
    }
    for (const key of ["goal", "successCriteria", "constraints"] as const) expect(b[key]).toEqual(a[key]);
    expect(b.manifest.promptVersion).toBe((JSON.parse(without) as { manifest: { promptVersion: string } }).manifest.promptVersion);
    expect(b.experienceAdvisories.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(b.experienceAdvisories).length).toBeLessThanOrEqual(2200);
    expect(withExperience.length - without.length).toBeLessThanOrEqual(2400);
  });
});
