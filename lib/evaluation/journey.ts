import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Source } from "@/lib/mission/contracts";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { boundedInvestigationPolicySchema } from "@/lib/types/mission";
import { textHash } from "@/lib/research/sourceRepository";
import { processInvestigationDelegations } from "@/lib/mission/investigationDelegation";
import { runMissionSlice } from "@/lib/mission/runner";
import { commandMission, createMission, editContinuationPolicy } from "@/lib/mission/missionService";
import { createSession } from "@/lib/auth/session";
import { createConversation } from "@/lib/conversation/service";
import { assertDirectiveEffect, effectiveContinuity, submitDirective } from "@/lib/continuity/directiveService";
import type { DecisionProvider } from "@/lib/mission/modelAdapter";

/**
 * Slice A journey harness: four synthetic project types, one continuous obligation.
 * It reuses the real Mission Runner, Worker scan, tool guards and result verifier.
 */

export type JourneyDefinition = {
  id: "developer" | "freelancer" | "research" | "course";
  label: string;
  projectTitle: string;
  scenario: "RESEARCH" | "COURSE_DESIGN";
  goal: string;
  initialMaterial: string;
  newMaterial: string;
  newMaterialCondition: string;
  redirectQuote: string;
  ending: "pause" | "cancel";
};

export type JourneyVersion = {
  revision: number; outputId: string; createdAt: string; sourceRefs: Array<{ id: string; hash: string }>;
  blockTexts: string[]; blocks: Array<{ blockId: string; text: string; kind: string; sourceIds: string[]; citations: Array<{ sourceId: string }> }>;
  sourceTexts: Record<string, string>; textHash: string; checkpointSeq: number | null; budgetUsed: unknown;
};
export type JourneyRecord = {
  definition: JourneyDefinition;
  missionId: string;
  projectId: string;
  versionIds: string[];
  phases: Array<{ phase: string; missionStatus: string; outputCount: number; checkpointCount: number; modelCalls: number; toolCalls: number; budgetUsed: unknown; lastError: unknown }>;
  versions: JourneyVersion[];
  tools: Array<{ tool: string; status: string; ordinal: number }>;
  modelRuns: Array<{ provider: string; model: string | null; usage: unknown }>;
  events: string[];
  wake: { woken: number; sameMission: boolean; inputChanged: boolean };
  control: {
    restriction?: { directiveIds: string[]; constraints: string[]; externalReadBlocked: boolean; outputsUnchanged: boolean };
    redirect?: { directiveIds: string[]; workingObjective: string | null; outputCountAfter: number };
    ending?: { action: string; status: string; extraDispatch: boolean; outputCountAfter: number };
  };
  failures: string[];
  sourceTexts: Record<string, string>;
  budget: { before: unknown; after: unknown };
};

function policy(modelCeiling = 40) {
  return boundedInvestigationPolicySchema.parse({
    mode: "BOUNDED_INVESTIGATION", schemaVersion: 1,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(), checkEveryMinutes: 60,
    maxModels: modelCeiling, maxTools: 48, maxMetadataRequests: 0,
    allowedTools: ["read_project_material", "save_mission_output", "inspect_project"],
    connectionIds: [], trackBranchHead: false, timezone: "Asia/Shanghai",
  });
}

async function createUser(label: string) {
  return db.user.create({ data: { username: "journey-" + label + "-" + randomUUID().slice(0, 8), displayName: label, passwordHash: "unused-journey" } });
}

type DecisionHooks = { beforeDecision?: (context: string) => void; onDecisionUsage?: (usage: { inputTokens: number | null; outputTokens: number | null }, provider: string) => void };
async function runUntilSettled(missionId: string, provider?: DecisionProvider, hooks?: DecisionHooks, maxSlices = 8) {
  for (let index = 0; index < maxSlices; index++) {
    const row = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    if (row.status !== "READY") break;
    await runMissionSlice({ id: missionId, ...(provider ? { provider } : {}), ...(hooks?.beforeDecision ? { beforeDecision: hooks.beforeDecision } : {}), ...(hooks?.onDecisionUsage ? { onDecisionUsage: hooks.onDecisionUsage } : {}) });
  }
  return db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
}

async function snapshotVersion(missionId: string) {
  const [outputs, checkpoints] = await Promise.all([
    db.agentMissionOutput.findMany({ where: { missionId }, orderBy: { revision: "asc" } }),
    db.agentMissionEvent.findMany({ where: { missionId, type: "CHECKPOINT_REACHED" }, orderBy: { seq: "asc" } }),
  ]);
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  return outputs.map(output => {
    const content = output.contentJson as { blocks?: Array<{ blockId?: string; text?: string; kind?: string; sourceIds?: string[]; citations?: Array<{ sourceId?: string }> }> };
    const text = (content.blocks ?? []).map(block => block.text ?? "").join("\n");
    const refs = (output.sourceRefsJson as Source[] | null) ?? [];
    const checkpoint = checkpoints.find(event => (event.payloadJson as { outputId?: string }).outputId === output.id);
    return {
      revision: output.revision, outputId: output.id, createdAt: output.createdAt.toISOString(),
      sourceRefs: refs.map(source => ({ id: source.id, hash: source.hash })),
      blockTexts: (content.blocks ?? []).map(block => block.text ?? ""),
      blocks: (content.blocks ?? []).map(block => ({ blockId: String(block.blockId ?? ""), text: String(block.text ?? ""), kind: String(block.kind ?? ""),
        sourceIds: (block.sourceIds ?? []).map(String), citations: (block.citations ?? []).map(citation => ({ sourceId: String(citation.sourceId ?? "") })) })),
      sourceTexts: Object.fromEntries(refs.filter(source => typeof source.text === "string").map(source => [source.id, source.text.slice(0, 4000)])),
      textHash: textHash(text),
      checkpointSeq: checkpoint?.seq ?? null, budgetUsed: mission.budgetUsedJson,
    };
  });
}

async function phase(record: JourneyRecord, phaseName: string, missionId: string) {
  const mission = await db.agentMission.findUniqueOrThrow({ where: { id: missionId } });
  const outputs = await snapshotVersion(missionId);
  const checkpoints = (await db.agentMissionEvent.count({ where: { missionId, type: "CHECKPOINT_REACHED" } }));
  record.phases.push({
    phase: phaseName, missionStatus: mission.status, outputCount: outputs.length, checkpointCount: checkpoints,
    modelCalls: Number((mission.budgetUsedJson as { models?: number } | null)?.models ?? 0),
    toolCalls: Number((mission.budgetUsedJson as { tools?: number } | null)?.tools ?? 0),
    budgetUsed: mission.budgetUsedJson, lastError: mission.lastErrorJson,
  });
  return outputs;
}

/** Provider used by the offline journey: reads the newest unreviewed source, then drafts from the whole evidence pack. */
function journeyProvider(latestPointers: () => Promise<Array<{ sourceId: string; sourceHash: string }>>): DecisionProvider {
  const readThisCycle = new Set<string>();
  const counts = new Map<string, number>();
  return async raw => {
    const context = JSON.parse(raw), skill = context.skillExecution;
    if (!skill) throw new Error("JOURNEY_REQUIRES_V2_SKILL_CONTEXT");
    const key = String(context.contextVersion) + ":" + String(context.planRevision) + ":" + skill.stage;
    if (skill.outputId && (skill.stage === "deliverable-creation" || readThisCycle.has(key)))
      return { choice: { kind: "await_event", outputId: skill.outputId, reason: "DELIVERABLE_READY", subscriptionIds: ["project-materials"] },
        provider: "INJECTED_V2_JOURNEY", model: "deterministic-journey", protocol: "JSON_CHOICE", usage: { inputTokens: 20, outputTokens: 10 } };
    if (skill.stage !== "deliverable-creation") {
      readThisCycle.add(key);
      const pointers = await latestPointers();
      const cycleKey = String(context.contextVersion);
      const count = counts.get(cycleKey) ?? 0;
      counts.set(cycleKey, count + 1);
      const pointer = pointers[count % pointers.length];
      return { choice: { kind: "tool", tool: "read_project_material", args: pointer, summary: "读取当前获准资料" },
        provider: "INJECTED_V2_JOURNEY", model: "deterministic-journey", protocol: "JSON_CHOICE", usage: { inputTokens: 20, outputTokens: 10 } };
    }
    const pack: Array<{ id: string; text: string }> = skill.evidencePack?.sources ?? [];
    const sources = pack.slice(-4).filter(source => source.id && source.text);
    const unknown: Array<{ column?: string }> = skill.evidencePack?.unknowns ?? [];
    if (!sources.length) throw new Error("JOURNEY_EVIDENCE_PACK_MISSING");
    const blocks = sources.map((source, index) => {
      const text = source.text.slice(0, 900);
      return { blockId: "source-" + (index + 1), kind: "PROJECT_OBSERVATION", text: "项目资料记载：" + text, sourceIds: [source.id],
        citations: [{ sourceId: source.id, start: 0, end: text.length, excerptHash: textHash(text) }] };
    });
    blocks.push({ blockId: "working-note", kind: "INFERENCE" as never,
      text: "本轮工作重点：" + (context.continuity?.workingObjective ?? context.goal) + "。" +
        (unknown.length ? "资料中仍缺少单位或口径的数值列按未知保留。" : "尚缺条件按原资料保留为未知。") +
        "私有工作稿不代表现实工作已经完成。", sourceIds: [] as never } as never);
    return { choice: { kind: "tool", tool: "save_mission_output", summary: "依据证据包更新私有工作稿", args: { blocks,
      missingInformation: unknown.slice(0, 6).map(item => (item.column || "数值列") + " 缺少单位或口径，按未知保留") } },
      provider: "INJECTED_V2_JOURNEY", model: "deterministic-journey", protocol: "JSON_CHOICE", usage: { inputTokens: 20, outputTokens: 10 } };
  };
}

export async function runJourney(definition: JourneyDefinition, providerMode: "fixture" | "http" | "live", options: { tokenCeiling?: number; modelCeiling?: number; beforeDecision?: (context: string) => void; onDecisionUsage?: (usage: { inputTokens: number | null; outputTokens: number | null }, provider: string) => void } = {}): Promise<JourneyRecord> {
  const tokenCeiling = options.tokenCeiling ?? 200000;
  const user = await createUser(definition.label);
  const project = await db.project.create({ data: { title: definition.projectTitle, description: "隔离合成项目，不含个人数据", goal: definition.goal, scenario: definition.scenario,
    memberships: { create: { userId: user.id, role: "OWNER" } } } });
  const firstCapture = await db.capture.create({ data: { projectId: project.id, rawText: definition.initialMaterial, sourceType: "TEXT" } });
  const policyValue = policy(options.modelCeiling ?? 40);
  // Use the production creation + policy-edit paths so continuity binding and delegation state are
  // exactly what the product creates, including the original continuityBinding used by canContinue.
  const created = await createMission(user.id, { runtimeProtocolVersion: 2, projectId: project.id,
    requestId: "journey-" + randomUUID(), goal: definition.goal, llmContextApproved: true });
  const mission = await editContinuationPolicy(user.id, created.id, { requestId: "journey-grant", expectedVersion: created.version, policy: policyValue });
  const record: JourneyRecord = {
    definition, missionId: mission.id, projectId: project.id, versionIds: ["capture:" + firstCapture.id], phases: [], versions: [], tools: [], modelRuns: [], sourceTexts: {},
    events: [], wake: { woken: 0, sameMission: true, inputChanged: false }, control: {}, failures: [],
    budget: { before: mission.budgetUsedJson, after: null },
  };
  const captureOrder: string[] = [firstCapture.id];
  const pointers = async () => {
    // Newest material first, in creation order (SQLite timestamps can tie within one millisecond).
    const result: Array<{ sourceId: string; sourceHash: string }> = [];
    for (const captureId of [...captureOrder].reverse()) {
      const source = await readProjectMaterial(project.id, "capture:" + captureId);
      if (source) result.push({ sourceId: source.id, sourceHash: source.hash });
    }
    return result;
  };
  const fixtureProvider = providerMode === "fixture" ? journeyProvider(pointers) : undefined;
  const hooks: DecisionHooks = { beforeDecision: options.beforeDecision, onDecisionUsage: options.onDecisionUsage };
  const run = () => runUntilSettled(mission.id, fixtureProvider, hooks);

  // 1. First bounded draft.
  await run();
  const first = await phase(record, "INITIAL_DRAFT", mission.id);
  if (first.length !== 1) record.failures.push("INITIAL_DRAFT_COUNT:" + first.length);

  // 2. New material arrives; the existing worker scan wakes the same Mission.
  const secondCapture = await db.capture.create({ data: { projectId: project.id, rawText: definition.newMaterial, sourceType: "TEXT" } });
  captureOrder.push(secondCapture.id);
  record.versionIds.push("capture:" + secondCapture.id);
  await db.agentMission.update({ where: { id: mission.id }, data: { nextAttemptAt: new Date(0) } });
  // A bounding journey must use the existing scanner, so the wake path is the product path.
  const beforeWake = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const wake = await processInvestigationDelegations(32);
  const afterWake = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  record.events.push(...(await db.agentMissionEvent.findMany({ where: { missionId: mission.id, type: { in: ["INVESTIGATION_INPUT_CHANGED", "INVESTIGATION_OBSERVATION_DUE"] } } }))
    .map(event => event.type));
  record.wake = { woken: wake.woken, sameMission: afterWake.id === beforeWake.id, inputChanged: afterWake.contextVersion > beforeWake.contextVersion };
  await run();
  const second = await phase(record, "NEW_MATERIAL_CONTINUATION", mission.id);
  if (second.length < 2) record.failures.push("CONTINUATION_OUTPUT_COUNT:" + second.length);

  const session = await createSession(user.id);
  const actor = { userId: user.id, sessionId: session.session.id };
  const conversation = await createConversation(actor, { requestId: "journey-conversation", scope: "PROJECT", projectId: project.id });
  const userRow = await db.user.findUniqueOrThrow({ where: { id: user.id } });

  // 3. A literal restriction must be persisted before the next model decision, and must not add a draft.
  const restrictionCommandId = "journey-restrict-" + randomUUID();
  await submitDirective(actor, conversation.id, { commandId: restrictionCommandId, expectedSeq: userRow.continuitySeq,
    scope: { projectId: project.id, missionId: mission.id }, operation: "SET", quote: "继续整理，但不要联网", timezone: "Asia/Shanghai", admission: "LITERAL" });
  const restrictionEvents = await db.agentDirectiveEvent.findMany({ where: { ownerUserId: user.id, commandId: restrictionCommandId } });
  const continuity = await effectiveContinuity(user.id, { projectId: project.id, missionId: mission.id });
  let externalBlocked = false;
  try { assertDirectiveEffect(continuity, "EXTERNAL_READ"); } catch { externalBlocked = true; }
  const beforeRestrictionRun = await db.agentMissionOutput.count({ where: { missionId: mission.id } });
  await runUntilSettled(mission.id, fixtureProvider, hooks, 3);
  record.control.restriction = { directiveIds: restrictionEvents.map(event => event.id), constraints: continuity.constraints,
    externalReadBlocked: externalBlocked, outputsUnchanged: (await db.agentMissionOutput.count({ where: { missionId: mission.id } })) === beforeRestrictionRun };
  await phase(record, "RESTRICTION_APPLIED", mission.id);

  // 4. A bounded working-objective redirect continues the same Mission and produces a new draft.
  const redirectCommandId = "journey-redirect-" + randomUUID();
  const latestUser = await db.user.findUniqueOrThrow({ where: { id: user.id } });
  await submitDirective(actor, conversation.id, { commandId: redirectCommandId, expectedSeq: latestUser.continuitySeq,
    scope: { projectId: project.id, missionId: mission.id }, operation: "SET", quote: definition.redirectQuote, timezone: "Asia/Shanghai", admission: "LITERAL" });
  const redirectEvents = await db.agentDirectiveEvent.findMany({ where: { ownerUserId: user.id, commandId: redirectCommandId } });
  await run();
  const third = await phase(record, "REDIRECTED_DELIVERY", mission.id);
  const redirectedContinuity = await effectiveContinuity(user.id, { projectId: project.id, missionId: mission.id });
  record.control.redirect = { directiveIds: redirectEvents.map(event => event.id), workingObjective: redirectedContinuity.workingObjective, outputCountAfter: third.length };
  if (third.length < 3) record.failures.push("REDIRECT_OUTPUT_COUNT:" + third.length);

  // 5. Pause or cancel ends further dispatch; the delivered versions stay readable.
  const current = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  try { await commandMission(user.id, mission.id, definition.ending, { requestId: "journey-" + definition.ending, expectedVersion: current.version }); }
  catch (error) { const code = String((error as { code?: string }).code ?? "UNKNOWN");
    // A mission already paused by its own guard is still stopped; pause remains accepted without a second transition.
    if (!(code === "INVALID_TRANSITION" && current.status === "PAUSED" && definition.ending === "pause")) record.failures.push("ENDING_ERROR:" + code + ":STATUS=" + current.status + ":ERROR=" + String((current.lastErrorJson as { code?: string } | null)?.code ?? "")); }
  const afterControl = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  const stepsBefore = await db.agentMissionStep.count({ where: { missionId: mission.id } });
  await db.agentMission.update({ where: { id: mission.id }, data: { nextAttemptAt: new Date(0) } });
  await processInvestigationDelegations(32);
  await runUntilSettled(mission.id, fixtureProvider, hooks, 2);
  const stepsAfter = await db.agentMissionStep.count({ where: { missionId: mission.id } });
  record.control.ending = { action: definition.ending, status: afterControl.status, extraDispatch: stepsAfter > stepsBefore,
    outputCountAfter: await db.agentMissionOutput.count({ where: { missionId: mission.id } }) };
  if (afterControl.status !== (definition.ending === "pause" ? "PAUSED" : "CANCELLED")) record.failures.push("ENDING_STATUS:" + afterControl.status);
  await phase(record, "ENDED", mission.id);

  record.versions = await snapshotVersion(mission.id);
  record.sourceTexts = Object.assign({}, ...record.versions.map(version => version.sourceTexts));
  record.tools = (await db.agentMissionStep.findMany({ where: { missionId: mission.id }, orderBy: { ordinal: "asc" } }))
    .map(step => ({ tool: step.toolName, status: step.status, ordinal: step.ordinal }));
  record.modelRuns = (await db.agentRun.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }))
    .filter(run => run.trace && (run.trace as { missionId?: string }).missionId === mission.id)
    .map(run => ({ provider: run.provider, model: ((run.trace as { model?: string }).model ?? null), usage: (run.trace as { usage?: unknown }).usage ?? null }));
  record.events = (await db.agentMissionEvent.findMany({ where: { missionId: mission.id }, orderBy: { seq: "asc" } })).map(event => event.type);
  const finalMission = await db.agentMission.findUniqueOrThrow({ where: { id: mission.id } });
  record.budget.after = finalMission.budgetUsedJson;
  const tokenUsage = record.modelRuns.reduce((total, run) => {
    const usage = run.usage as { inputTokens?: number | null; outputTokens?: number | null } | null;
    return total + Number(usage?.inputTokens ?? 0) + Number(usage?.outputTokens ?? 0);
  }, 0);
  if (tokenUsage > tokenCeiling) record.failures.push("TOKEN_CEILING_EXCEEDED:" + tokenUsage);
  return record;
}

export const JOURNEYS: JourneyDefinition[] = [
  { id: "developer", label: "独立开发发布", projectTitle: "独立开发版本 · 发布准备", scenario: "RESEARCH",
    goal: "整理下一版本发布说明", initialMaterial: "当前版本记录：登录流程已完成；移动端输入回归尚未记录。",
    newMaterial: "新增发布记录：移动端输入回归已补测，分享入口仍未验证；结果尚未独立复现。",
    newMaterialCondition: "分享入口仍未验证", redirectQuote: "今天先核对第二版交付依据", ending: "pause" },
  { id: "freelancer", label: "客户交付", projectTitle: "客户交付 · 验收材料", scenario: "RESEARCH",
    goal: "整理客户验收交付说明", initialMaterial: "客户 brief：交付页面结构与操作说明；客户未确认最终验收口径。",
    newMaterial: "客户新增反馈：需要保留旧版操作步骤；验收口径仍未确认，不能写成已通过。",
    newMaterialCondition: "验收口径仍未确认", redirectQuote: "今天先核对客户反馈对应的交付说明", ending: "cancel" },
  { id: "research", label: "科研阶段汇报", projectTitle: "科研阶段汇报 · 可核查结论", scenario: "RESEARCH",
    goal: "整理可核查的实验阶段汇报", initialMaterial: "实验记录：测试集A 20 人、测试集B 12 人，条件不同；指标不能直接比较，seed 条件缺失。",
    newMaterial: "补充记录：新增同条件测试集B副本；结果尚未独立复现，单位与口径仍需核对。",
    newMaterialCondition: "尚未独立复现", redirectQuote: "今天先核对第二版资料中的限制条件", ending: "pause" },
  { id: "course", label: "学生课程项目", projectTitle: "课程项目 · 阶段交付", scenario: "COURSE_DESIGN",
    goal: "整理课程项目交付说明", initialMaterial: "课程要求：提交设计说明、SQL 脚本与演示材料；截止日期未写明。",
    newMaterial: "补充材料：已补 SQL 脚本，演示材料仍缺失；评分口径未给出。",
    newMaterialCondition: "截止日期未写明", redirectQuote: "今天先核对课程要求对应的交付材料", ending: "cancel" },
];
