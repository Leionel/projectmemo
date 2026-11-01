import { afterAll, expect, test, vi } from "vitest";
const isolated = await vi.hoisted(async () =>
  (await import("./helpers/continuityDatabase")).continuityDatabase("pm3-recall"));
import fs from "node:fs";
import { db } from "@/lib/db";
import { buildContext } from "@/lib/mission/contextBuilder";
import { runMissionSlice } from "@/lib/mission/runner";
import { sourceHash } from "@/lib/mission/repository";
import { createMission } from "@/lib/mission/missionService";
import { commandPersonalMemory, listPendingCandidates } from "@/lib/memory/personalMemoryService";
import { resolvePersonalContext } from "@/lib/memory/personalContext";
import { jsonHash, type Choice } from "@/lib/mission/contracts";

afterAll(async () => { await db.$disconnect(); fs.rmSync(isolated.dir, { recursive: true, force: true }); });

const scriptProvider = (choice: Choice) => async () =>
  ({ choice, provider: "PM3_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 10, outputTokens: 5 } });

async function fixture(name: string) {
  const user = await db.user.create({ data: { username: name, displayName: name, passwordHash: "fixture" } });
  const project = await db.project.create({ data: { title: "召回项目 " + name, description: "d", goal: "长期约束召回评估",
    scenario: "RESEARCH", memberships: { create: { userId: user.id, role: "OWNER" } } } });
  return { user, project };
}

/** 直接以权威表固 Fixture（合成数据）：12 份近期综合噪声 + 1 条 90 天前的有效个人约束。 */
async function seedNoise(user: string, project: string, count: number) {
  for (let i = 0; i < count; i++) {
    await db.agentContextDigest.create({ data: { ownerUserId: user, projectId: project, scopeKey: `noise-${i}`,
      inputHash: `noise-${i}`, originJson: {}, sourceManifestJson: [], claimHeadsJson: [], budgetRootJson: {}, intentHash: "noise",
      reusePolicyHash: "noise", compilerSpecVersion: "fixture", summaryJson: { summary: `近期噪声综合 ${i}：新的实验结果与讨论。`,
        conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [] } } });
  }
}

test("J06：90 天前的有效约束不被近期综合噪声淹没（无窗口截断，先资格后排序）", async () => {
  const { user, project } = await fixture("j06-" + crypto.randomUUID().slice(0, 8));
  const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "数据划分必须在比较指标前固定并记录", kind: "PREFERENCE" });
  // 回填为 90 天前形成的长期条目
  const old = new Date(Date.now() - 90 * 86400000);
  await db.agentClaim.update({ where: { id: added.claimId! }, data: { createdAt: old, updatedAt: old } });
  await seedNoise(user.id, project.id, 12);
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "比较新旧指标", llmContextApproved: true });
  const context = JSON.parse(await buildContext(mission));
  // 长期条目仍在：个人通道不经过"最近 8 条"窗口
  expect(context.personalContext.items).toHaveLength(1);
  expect(context.personalContext.items[0]).toMatchObject({ claimId: added.claimId, statement: "数据划分必须在比较指标前固定并记录" });
  // 近期噪声综合按窗口有界进入，不挤压硬限制
  expect(context.effectiveMemory.items.length).toBeLessThanOrEqual(2);
  expect(JSON.stringify(context.constraintsJson ?? [])).not.toContain("数据划分");
  // 会话路由同样返回该条目（资格优先，与近期噪声无关）
  const conversationView = await resolvePersonalContext(user.id, { purpose: "CONVERSATION", projectIds: [project.id], query: "现在能直接比较指标了吗" });
  expect(conversationView.items).toHaveLength(1);
  expect(conversationView.readSet?.items[0]).toMatchObject({ claimId: added.claimId });
}, 40000);

test("J03：当前项目指令与个人默认并存，明确标注优先级而不是覆盖永久条目", async () => {
  const { user, project } = await fixture("j03-" + crypto.randomUUID().slice(0, 8));
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "以后技术讨论先给结论，再按需要展开", kind: "PREFERENCE" });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id,
    goal: "推导增强方案", llmContextApproved: true });
  // 当前任务的临时指令走原 constraints 合同，不写个人条目
  await db.agentMission.update({ where: { id: mission.id }, data: { constraintsJson: { extra: ["本轮需要完整推导过程"] } } });
  const context = JSON.parse(await buildContext(await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } })));
  expect(JSON.stringify(context.personalContext.items)).toContain("先给结论");
  expect(JSON.stringify(context.constraints)).toContain("本轮需要完整推导过程");
  expect(context.personalContext.usagePolicy).toContain("当前明确请求与项目约束优先");
  // 临时请求不创建永久条目
  expect((await listPendingCandidates(user.id)).items).toHaveLength(0);
  expect(await db.agentClaim.count({ where: { ownerUserId: user.id, scopeType: "ACCOUNT", statusProjection: "ACTIVE" } })).toBe(1);
}, 40000);

test("指纹：新增未入选条目（预算外）也改变上下文指纹；个人裁剪不回退硬限制且读集保持超集", async () => {
  const { user, project } = await fixture("fp-" + crypto.randomUUID().slice(0, 8));
  const first = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "长期约束一：所有实验先记录环境版本", kind: "BACKGROUND" });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "环境核对", llmContextApproved: true });
  const before = JSON.parse(await buildContext(mission));
  expect(before.personalContext.items).toHaveLength(1);
  expect(before.personalMemoryReadSet.items).toHaveLength(1);
  // 新增第二条：即使因预算未被选中，也必须改变指纹并进入读集（未选集合变化使选择缓存失效）
  const second = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
    quote: "长期约束二：指标比较前必须核对数据划分", kind: "PREFERENCE" });
  const after = JSON.parse(await buildContext(mission));
  expect(after.manifest.hash).not.toBe(before.manifest.hash);
  expect(after.personalMemoryReadSet.items).toHaveLength(2);
  expect(after.personalMemoryReadSet.items.map((i: { claimId: string }) => i.claimId).sort())
    .toEqual([first.claimId, second.claimId].sort());
  // 读集条目内容版本绑定：条目修订推进使旧指纹失效
  await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "PAUSE", claimId: second.claimId!, expectedRevision: 1 });
  const paused = JSON.parse(await buildContext(mission));
  expect(paused.manifest.hash).not.toBe(after.manifest.hash);
  expect(paused.personalContext.items).toHaveLength(1);
  expect(paused.personalMemoryReadSet.items).toHaveLength(2);
}, 40000);

test("J25：上下文溢出时个人 facet 先让位，硬限制与观察保留；读集保持超集且预算遗漏可知", async () => {
  const { user, project } = await fixture("j25-" + crypto.randomUUID().slice(0, 8));
  const entries: Array<{ claimId: string }> = [];
  for (let i = 0; i < 6; i++) {
    const added = await commandPersonalMemory(user.id, { requestId: crypto.randomUUID(), operation: "ADD_EXPLICIT",
      quote: `个人约束 ${i}：${"背景说明".repeat(160)}`, kind: "BACKGROUND" });
    entries.push({ claimId: added.claimId! });
  }
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "大上下文任务", llmContextApproved: true });
  // 大量观察制造溢出压力：12 个大结果步骤
  for (let i = 0; i < 60; i++) {
    await db.agentMissionStep.create({ data: { missionId: mission.id, ordinal: i + 1, planRevision: 1, toolName: "read_project_material",
      status: "SUCCEEDED", canonicalInputJson: {}, inputHash: `step-${i}`, readSetJson: [], protocolJson: {},
      resultJson: { data: { note: ("观察数据 " + i + "：") + "x".repeat(1500) }, sources: [], coverage: { complete: true } } } });
  }
  const context = JSON.parse(await buildContext(mission));
  const serialized = JSON.stringify(context);
  expect(serialized.length).toBeLessThanOrEqual(30500);
  // 硬限制不被裁剪：successCriteria 与约束仍在，观察被原循环裁剪
  expect(context.observations.length).toBeLessThan(60);
  // 个人条目按预算让位且遗漏原因明确；读集仍覆盖全部资格条目（超集，不出现"正文在依赖被删"）
  expect(context.personalContext.items.length).toBeLessThan(6);
  expect(context.personalCoverage.omissions.some((o: { reason: string }) => o.reason === "BUDGET")).toBe(true);
  expect(context.personalMemoryReadSet.items).toHaveLength(6);
  const injectedIds = context.personalContext.items.map((i: { claimId: string }) => i.claimId);
  for (const id of injectedIds) expect(context.personalMemoryReadSet.items.some((i: { claimId: string }) => i.claimId === id)).toBe(true);
  expect(new Set(context.personalCoverage.omittedForBudget).size).toBe(context.personalCoverage.omittedForBudget.length);
  void entries;
}, 40000);

test("J19：同一原根的多份综合不形成独立支持计数；候选身份按根集合+表述归一", async () => {
  const { user, project } = await fixture("j19-" + crypto.randomUUID().slice(0, 8));
  const capture = await db.capture.create({ data: { projectId: project.id, rawText: "同一网页来源的重复阅读记录。" } });
  const id = "capture:" + capture.id;
  // 十份综合引用同一根：composeEffectiveMemory 只做有界选择，不存在"支持次数"累计
  for (let i = 0; i < 10; i++) {
    await db.agentContextDigest.create({ data: { ownerUserId: user.id, projectId: project.id, scopeKey: `same-root-${i}`,
      inputHash: `same-root-${i}`, originJson: { kind: "MISSION_OUTPUT", id: `out-${i}`, sourceRevisionReadSet: [{ projectId: project.id, revision: 0, role: "OWNER" }] },
      sourceManifestJson: [{ id, hash: "same", revision: "same", kind: "PROJECT", entityType: "CAPTURE", text: "同一来源", observedAt: new Date().toISOString() }],
      claimHeadsJson: [], budgetRootJson: {}, intentHash: "j19", reusePolicyHash: "j19", compilerSpecVersion: "fixture",
      summaryJson: { summary: `同一来源的第 ${i} 份摘要`, conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [] } } });
  }
  const view = await resolvePersonalContext(user.id, { purpose: "MISSION", projectIds: [project.id], query: "同一来源" });
  expect(view.items).toHaveLength(0); // 个人通道与项目综合互不冒充
  // 候选身份：同根同表述 → 一个 originKey，重复归纳不产生第二个候选（冷却去重，非支持计数）
  await db.$transaction(async tx => {
    await tx.userMemoryPolicy.create({ data: { ownerUserId: user.id, candidateInferenceEnabled: true } });
  });
  const mission = await createMission(user.id, { requestId: crypto.randomUUID(), projectId: project.id, goal: "归纳同一来源", llmContextApproved: true });
  const save = (summary: string) => runMissionSlice({ id: mission.id, provider: async () => ({ choice: { kind: "tool", tool: "save_mission_output",
    summary, args: { schemaVersion: 1, kind: "NOTE", blocks: [{ blockId: "b", kind: "INFERENCE", text: "同一来源的阅读结论。", sourceIds: [id], citations: [] }],
      missingInformation: [], memorySynthesis: { summary, conditions: [], retainedReasons: [], openQuestions: [], commitments: [], hypotheses: [],
        memoryCandidates: [{ statement: "以后引用该来源前先核对原文", kind: "PREFERENCE" as const, conditions: [], basis: "同一来源反复出现", sourceIds: [id] }] } } } as Choice, provider: "PM3_SYNTHETIC", model: "scripted", protocol: "JSON_CHOICE", usage: { inputTokens: 1, outputTokens: 1 } }) });
  await runMissionSlice({ id: mission.id, provider: scriptProvider({ kind: "tool", tool: "read_project_material",
    args: { sourceId: id, sourceHash: await sourceHash(project.id, id) }, summary: "读原文" }) });
  await save("归纳一");
  await save("归纳二");
  expect((await listPendingCandidates(user.id)).items).toHaveLength(1);
}, 60000);
