import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";

const isolated = await vi.hoisted(async () => {
  const fs = await import("node:fs"), os = await import("node:os"), path = await import("node:path");
  const Database = (await import("better-sqlite3")).default;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "projectmemo-experience-"));
  const file = path.join(directory, "experience.db");
  process.env.DATABASE_URL = `file:${file.replaceAll("\\", "/")}`;
  Object.assign(process.env, { MISSION_ENABLED: "true", PROJECT_EXPERIENCE_ENABLED: "true" });
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
import { buildTrajectoryIndex, type TrajectoryEntry } from "@/lib/experience/trajectoryIndex";
import { extractCandidates } from "@/lib/experience/extract";
import { injectionDecisions, recordUses, suggestionsForMission } from "@/lib/experience/injection";
import { syncExperiences } from "@/lib/experience/extract";
import { listExperiences, actOnExperience } from "@/lib/experience/service";

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

type StepSpec = { tool: string; status?: string; version?: string; protocol?: number; effectKey?: string };

/** 直接构造轨迹（跳过 runner），隔离验证提炼与注入规则；每个场景用唯一工具序列避免 patternHash 串扰。 */
async function seedMission(owner: string, project: string, spec: {
  goal: string; status?: string; steps: StepSpec[]; output?: boolean; adoption?: boolean;
  action?: { status: string; resultCard?: boolean }; protocolError?: { code: string; reason: string } | null;
}) {
  const m = await createMission(owner, { projectId: project, requestId: crypto.randomUUID(), goal: spec.goal });
  let ordinal = 0;
  for (const step of spec.steps) {
    ordinal += 1;
    await db.agentMissionStep.create({ data: {
      missionId: m.id, ordinal, planRevision: 1, toolName: step.tool, toolVersion: step.version ?? "1",
      status: step.status ?? "SUCCEEDED", canonicalInputJson: {}, inputHash: `h-${crypto.randomUUID()}`,
      readSetJson: [], resultJson: undefined,
      effectKey: step.effectKey ?? null,
      protocolJson: step.protocol === undefined ? undefined : { protocol: "JSON_CHOICE", schemaVersion: step.protocol } as never,
    } });
  }
  if (spec.output) {
    const output = await db.agentMissionOutput.create({ data: { missionId: m.id, revision: 1, kind: "REPORT_DRAFT", contentJson: { blocks: [] }, sourceRefsJson: [], claimChecksJson: [] } });
    if (spec.adoption) {
      const artifact = await db.generatedArtifact.create({ data: { projectId: project, artifactType: "weekly_report", content: "adopted" } });
      await db.missionArtifactReceipt.create({ data: { projectId: project, missionId: m.id, outputId: output.id, outputRevision: 1, outputHash: "x", artifactId: artifact.id, artifactType: "weekly_report", sourceManifestJson: {}, blockMapJson: {}, verificationSnapshotJson: {}, createdByUserId: owner, requestId: `r-${crypto.randomUUID()}`, payloadHash: "x" } });
    }
  }
  if (spec.action) {
    const effectKey = `mission:${m.id}:step:1`;
    let resultCardId: string | null = null;
    if (spec.action.resultCard) {
      const capture = await db.capture.create({ data: { projectId: project, rawText: "行动复盘", sourceType: "Agent行动回执" } });
      resultCardId = (await db.knowledgeCard.create({ data: { projectId: project, captureId: capture.id, type: "reflection", title: "行动复盘", summary: "复盘", keywords: [], relatedTasks: [], nextActions: [], importance: 3 } })).id;
    }
    const action = await db.actionItem.create({ data: { projectId: project, title: "行动", dedupeKey: effectKey, status: spec.action.status as never, resultCardId } });
    const step = await db.agentMissionStep.findFirstOrThrow({ where: { missionId: m.id, ordinal: 1 } });
    await db.agentMissionStep.update({ where: { id: step.id }, data: { effectKey, resultJson: { data: { actionId: action.id } } as never } });
  }
  if (spec.protocolError) {
    const seq = (await db.agentMissionEvent.count({ where: { missionId: m.id } })) + 1;
    await db.agentMissionEvent.create({ data: { missionId: m.id, seq, type: "MODEL_PROTOCOL_ERROR", payloadJson: { code: spec.protocolError.code, diagnostic: { reason: spec.protocolError.reason } } } });
  }
  if (spec.status && spec.status !== "READY") await db.agentMission.update({ where: { id: m.id }, data: { status: spec.status } });
  return m;
}

async function experienceByTools(tools: string[], kind = "WORKFLOW") {
  const row = await db.agentExperience.findFirstOrThrow({ where: { projectId, kind } });
  // findFirst 不可靠时按工具序列精确匹配
  const rows = await db.agentExperience.findMany({ where: { projectId, kind } });
  return rows.find(r => {
    const applicability = r.applicabilityJson as { tools?: string[] };
    return (applicability.tools ?? []).length === tools.length && (applicability.tools ?? []).every((t, i) => t === tools[i]);
  }) ?? row;
}

describe("P3-A 轨迹索引：四层结果标签互不混淆", () => {
  it("工程执行成功、用户采用、行动完成、用户自述效果分别标注", async () => {
    const engineeringOnly = await seedMission(userId, projectId, { goal: "只有工程成功", status: "SUCCEEDED", steps: [{ tool: "layer_a1" }, { tool: "layer_a2" }], output: true });
    const adopted = await seedMission(userId, projectId, { goal: "已采用成果", status: "SUCCEEDED", steps: [{ tool: "layer_b1" }, { tool: "layer_b2" }], output: true, adoption: true });
    const index = await buildTrajectoryIndex(userId, projectId);
    const entryOf = (id: string): TrajectoryEntry => index.entries.find(e => e.missionId === id)!;
    expect(entryOf(engineeringOnly.id)).toMatchObject({ engineeringCompleted: true, adoptionCount: 0, realOutcome: "NOT_INFERRED" });
    expect(entryOf(adopted.id)).toMatchObject({ engineeringCompleted: true, adoptionCount: 1 });
    expect([...new Set(index.entries.map(e => e.realOutcome))].every(v => v === "USER_ATTESTED" || v === "NOT_INFERRED")).toBe(true);
  });
  it("行动完成通过批准回执链读取，模拟行动不计入", async () => {
    const done = await seedMission(userId, projectId, { goal: "带行动完成", status: "SUCCEEDED", steps: [{ tool: "layer_c1" }], action: { status: "DONE", resultCard: true } });
    let index = await buildTrajectoryIndex(userId, projectId);
    let entry = index.entries.find(e => e.missionId === done.id)!;
    expect(entry.actionOutcomes).toEqual([{ actionId: expect.any(String), status: "DONE", resultCardId: expect.any(String) }]);
    expect(entry.realOutcome).toBe("USER_ATTESTED");
    const actionId = entry.actionOutcomes[0].actionId;
    await db.actionItem.update({ where: { id: actionId }, data: { isSimulated: true } });
    index = await buildTrajectoryIndex(userId, projectId);
    entry = index.entries.find(e => e.missionId === done.id)!;
    expect(entry.actionOutcomes).toEqual([]);
    expect(entry.realOutcome).toBe("NOT_INFERRED");
    await db.actionItem.update({ where: { id: actionId }, data: { isSimulated: false } });
  });
  it("严格按用户与项目隔离，不读取他人轨迹", async () => {
    await seedMission(otherUserId, otherProjectId, { goal: "他人委托", status: "SUCCEEDED", steps: [{ tool: "layer_d1" }], output: true, adoption: true });
    const mine = await buildTrajectoryIndex(userId, projectId);
    const other = await buildTrajectoryIndex(otherUserId, otherProjectId);
    expect(other.entries.some(e => mine.entries.some(m => m.missionId === e.missionId))).toBe(false);
    expect(mine.entries.some(e => e.goal === "他人委托")).toBe(false);
  });
});

describe("P3-A 候选提炼：去重、样本门槛、不自动激活", () => {
  it("同一次重试不重复计样本：一个委托只贡献一个支持样本", async () => {
    const one = await seedMission(userId, projectId, { goal: "重试委托", status: "SUCCEEDED", steps: [{ tool: "retry_a", status: "FAILED", protocol: 1 }, { tool: "retry_a", protocol: 1 }, { tool: "retry_b", protocol: 1 }], output: true, adoption: true });
    await syncExperiences(userId, projectId);
    const wf = await experienceByTools(["retry_a", "retry_b"]);
    expect((wf.sampleMissionIdsJson as string[])).toEqual([one.id]);
    expect(wf.supportCount).toBe(1);
    expect(wf.status).toBe("CANDIDATE");
    await syncExperiences(userId, projectId);
    const again = await experienceByTools(["retry_a", "retry_b"]);
    expect(again.supportCount).toBe(1);
    expect(again.status).toBe("CANDIDATE");
  });
  it("两个不同委托达到样本门槛后自动进入 SHADOW，但绝不自动 ACTIVE", async () => {
    await seedMission(userId, projectId, { goal: "样本A", status: "SUCCEEDED", steps: [{ tool: "alpha_1", protocol: 1 }, { tool: "alpha_2", protocol: 1 }], output: true, adoption: true });
    await seedMission(userId, projectId, { goal: "样本B", status: "SUCCEEDED", steps: [{ tool: "alpha_1", protocol: 1 }, { tool: "alpha_2", protocol: 1 }], output: true, adoption: true });
    await syncExperiences(userId, projectId);
    const wf = await experienceByTools(["alpha_1", "alpha_2"]);
    expect(wf.status).toBe("SHADOW");
    expect(wf.supportCount).toBe(2);
    expect(await db.agentExperience.count({ where: { projectId, status: "ACTIVE" } })).toBe(0);
  });
  it("失败后同工具修复成功提炼 GUARDRAIL；未修复同因轨迹计入反例", async () => {
    const repaired = await seedMission(userId, projectId, {
      goal: "协议失败后修复", status: "SUCCEEDED",
      steps: [{ tool: "guard_tool", status: "FAILED", protocol: 1 }, { tool: "guard_tool", protocol: 1 }, { tool: "guard_after", protocol: 1 }],
      output: true, adoption: true, protocolError: { code: "MODEL_PROTOCOL_ERROR", reason: "TRUNCATED_JSON" },
    });
    await seedMission(userId, projectId, { goal: "协议失败未修复", status: "PAUSED", steps: [{ tool: "guard_tool", status: "FAILED", protocol: 1 }], protocolError: { code: "MODEL_PROTOCOL_ERROR", reason: "TRUNCATED_JSON" } });
    const index = await buildTrajectoryIndex(userId, projectId);
    const entry = index.entries.find(e => e.missionId === repaired.id)!;
    expect(entry.guardrailObservations).toEqual([{ tool: "guard_tool", reasonClass: "TRUNCATED_JSON", repaired: true }]);
    const candidates = extractCandidates(index);
    const guard = candidates.find(c => c.kind === "GUARDRAIL" && c.pattern.tool === "guard_tool")!;
    expect(guard.pattern).toEqual({ tool: "guard_tool", reasonClass: "TRUNCATED_JSON" });
    expect(guard.supportMissionIds).toEqual([repaired.id]);
    expect(guard.counterMissionIds.length).toBe(1);
  });
  it("同模式工程成功但未采用的委托成为 WORKFLOW 反例", async () => {
    await seedMission(userId, projectId, { goal: "反例：未采用", status: "SUCCEEDED", steps: [{ tool: "counter_1", protocol: 1 }, { tool: "counter_2", protocol: 1 }], output: true });
    const index = await buildTrajectoryIndex(userId, projectId);
    const candidates = extractCandidates(index);
    const supports = candidates.filter(c => c.kind === "WORKFLOW" && c.applicability.tools[0] === "counter_1");
    // 未采用轨迹不产生支持样本，但会作为同模式反例记录在既有候选上
    expect(supports).toHaveLength(0);
    expect(candidates.some(c => c.kind === "WORKFLOW" && c.counterMissionIds.length > 0)).toBe(false);
    const withAdoption = await seedMission(userId, projectId, { goal: "反例对照：已采用", status: "SUCCEEDED", steps: [{ tool: "counter_1", protocol: 1 }, { tool: "counter_2", protocol: 1 }], output: true, adoption: true });
    const next = extractCandidates(await buildTrajectoryIndex(userId, projectId));
    const wf = next.find(c => c.kind === "WORKFLOW" && c.applicability.tools[0] === "counter_1")!;
    expect(wf.supportMissionIds).toEqual([withAdoption.id]);
    expect(wf.counterMissionIds.length).toBe(1);
  });
});

describe("P3-A 注入：建议性质、失效停注入、历史保留", () => {
  it("只有用户激活后的经验进入模型上下文，且使用记录不重复", async () => {
    const target = await experienceByTools(["alpha_1", "alpha_2"]);
    await actOnExperience(userId, projectId, target.id, { action: "ACTIVATE", requestId: crypto.randomUUID() });
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "使用经验的新委托" });
    await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: 1, planRevision: 1, toolName: "alpha_1", toolVersion: "1", status: "SUCCEEDED", canonicalInputJson: {}, inputHash: "x", readSetJson: [], protocolJson: { protocol: "JSON_CHOICE", schemaVersion: 1 } } });
    const decisions = await injectionDecisions(m, [{ name: "alpha_1", version: "1" }], 1);
    const injected = decisions.filter(d => "advisory" in d);
    expect(injected).toHaveLength(1);
    expect(injected[0]).toMatchObject({ advisory: { note: "项目内经验建议，不改变权限" } });
    await recordUses(m.id, decisions, "hash-a");
    await recordUses(m.id, decisions, "hash-b");
    expect(await db.agentExperienceUse.count({ where: { missionId: m.id } })).toBe(1);
    const context = JSON.parse(await buildContext(m));
    expect(context.experienceAdvisories).toHaveLength(1);
    expect(context.experienceAdvisories[0].statement).toContain("建议");
  });
  it("SHADOW 不进入模型上下文，但在委托详情可见", async () => {
    await seedMission(userId, projectId, { goal: "影子样本1", status: "SUCCEEDED", steps: [{ tool: "shadow_1", protocol: 1 }, { tool: "shadow_2", protocol: 1 }], output: true, adoption: true });
    await seedMission(userId, projectId, { goal: "影子样本2", status: "SUCCEEDED", steps: [{ tool: "shadow_1", protocol: 1 }, { tool: "shadow_2", protocol: 1 }], output: true, adoption: true });
    await syncExperiences(userId, projectId);
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "影子对照" });
    const suggestions = await suggestionsForMission(m);
    expect(suggestions.some(s => s.status === "SHADOW")).toBe(true);
    const context = JSON.parse(await buildContext(m));
    expect(context.experienceAdvisories.every((a: { id: string }) => suggestions.some(s => s.id === a.id && s.status === "ACTIVE"))).toBe(true);
  });
  it("工具版本不兼容时停止新注入，历史使用记录保留", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "版本升级后" });
    await db.agentMissionStep.create({ data: { missionId: m.id, ordinal: 1, planRevision: 1, toolName: "alpha_1", toolVersion: "2", status: "SUCCEEDED", canonicalInputJson: {}, inputHash: "x", readSetJson: [], protocolJson: { protocol: "JSON_CHOICE", schemaVersion: 1 } } });
    const decisions = await injectionDecisions(m, [{ name: "alpha_1", version: "2" }], 1);
    const active = await experienceByTools(["alpha_1", "alpha_2"]);
    expect(decisions).toEqual([{ suppressed: { experienceId: active.id, reason: "TOOL_VERSION_MISMATCH:alpha_1" } }]);
    expect(await db.agentExperienceUse.count()).toBeGreaterThanOrEqual(1);
  });
  it("协议 schemaVersion 不兼容时同样停止注入", async () => {
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "协议升级后" });
    const active = await experienceByTools(["alpha_1", "alpha_2"]);
    expect(await injectionDecisions(m, [], 99)).toEqual([{ suppressed: { experienceId: active.id, reason: "PROTOCOL_VERSION_MISMATCH:99" } }]);
  });
  it("撤销后不再注入；反例追平支持样本时也停止注入", async () => {
    const rows = await db.agentExperience.findMany({ where: { projectId, status: "ACTIVE" } });
    expect(rows).toHaveLength(1);
    await actOnExperience(userId, projectId, rows[0].id, { action: "REVOKE", requestId: crypto.randomUUID(), reason: "测试撤销" });
    const m = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "撤销后" });
    expect(await injectionDecisions(m, [], 1)).toEqual([]);
    const shadowRow = await experienceByTools(["shadow_1", "shadow_2"]);
    await db.agentExperience.update({ where: { id: shadowRow.id }, data: { status: "ACTIVE", counterCount: shadowRow.supportCount } });
    const decisions = await injectionDecisions(m, [], 1);
    expect(decisions).toEqual([{ suppressed: { experienceId: shadowRow.id, reason: "EVIDENCE_TURNED_AGAINST" } }]);
  });
});

describe("P3-A 管理接口：状态机与越权", () => {
  it("CANDIDATE 不可激活；SHADOW 激活幂等；他人项目不可访问", async () => {
    const candidate = await experienceByTools(["retry_a", "retry_b"]);
    expect(candidate.status).toBe("CANDIDATE");
    await expect(actOnExperience(userId, projectId, candidate.id, { action: "ACTIVATE", requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 409 });
    const shadow = await experienceByTools(["shadow_1", "shadow_2"]);
    const first = await actOnExperience(userId, projectId, shadow.id, { action: "ACTIVATE", requestId: crypto.randomUUID() });
    const again = await actOnExperience(userId, projectId, shadow.id, { action: "ACTIVATE", requestId: crypto.randomUUID() });
    expect(first.status).toBe("ACTIVE");
    expect(again.status).toBe("ACTIVE");
    await expect(actOnExperience(otherUserId, projectId, shadow.id, { action: "REVOKE", requestId: crypto.randomUUID() })).rejects.toMatchObject({ status: 404 });
  });
  it("列表给出轨迹统计且开关关闭时不执行同步、不注入", async () => {
    const listed = await listExperiences(userId, projectId);
    expect(listed.enabled).toBe(true);
    expect(listed.trajectory!.engineeringSucceeded).toBeGreaterThan(0);
    expect(listed.trajectory!.adopted).toBeGreaterThan(0);
    expect(listed.trajectory!.realOutcomeAttested).toBeGreaterThan(0);
    process.env.PROJECT_EXPERIENCE_ENABLED = "0";
    try {
      const disabled = await listExperiences(userId, projectId);
      expect(disabled.enabled).toBe(false);
      const context = await buildContext(await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "关闭后" }));
      expect(JSON.parse(context).experienceAdvisories).toEqual([]);
    } finally {
      process.env.PROJECT_EXPERIENCE_ENABLED = "1";
    }
  });
});

describe("P3-A 冻结任务对照探针（规则/mock，不宣称真实效果）", () => {
  it("结构化经验相对无经验：正确性、不阻断、负迁移防护与成本上限", async () => {
    // 冻结任务：同一委托 fixture，仅切换经验注入。
    const frozen = await createMission(userId, { projectId, requestId: crypto.randomUUID(), goal: "冻结对照任务：整理资料并形成带来源草稿" });
    process.env.PROJECT_EXPERIENCE_ENABLED = "0";
    let without: string;
    try { without = await buildContext(frozen); } finally { process.env.PROJECT_EXPERIENCE_ENABLED = "1"; }
    const withExperience = await buildContext(frozen);
    const a = JSON.parse(without), b = JSON.parse(withExperience);
    // 正确性：建议内容来自真实样本（含适用条件与建议声明），非编造。
    expect(b.experienceAdvisories.length).toBeGreaterThan(0);
    for (const advisory of b.experienceAdvisories as Array<{ statement: string; conditions: string[] }>) {
      expect(advisory.statement).toContain("建议");
      expect(advisory.conditions.length).toBeGreaterThan(0);
    }
    // 不改变权限/不阻断：上下文其余结构与无经验版本一致，goal/successCriteria/constraints 未被改写。
    for (const key of ["goal", "successCriteria", "constraints", "planRevision"]) expect(b[key]).toEqual(a[key]);
    expect(b.manifest.promptVersion).toBe(a.manifest.promptVersion);
    // 负迁移防护：协议不匹配（99）的经验已在上文被抑制，不进入建议列表；建议不含任何"禁止/必须跳过"式指令。
    expect(JSON.stringify(b.experienceAdvisories)).not.toContain("PROTOCOL_VERSION_MISMATCH");
    for (const advisory of b.experienceAdvisories as Array<{ statement: string }>) expect(advisory.statement).not.toMatch(/禁止|必须跳过|不要执行/);
    // 成本：建议块有界（≤3 条，总长 ≤2000 字符）。
    expect(b.experienceAdvisories.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(b.experienceAdvisories).length).toBeLessThanOrEqual(2000);
    expect(withExperience.length - without.length).toBeLessThanOrEqual(2200);
  });
});
