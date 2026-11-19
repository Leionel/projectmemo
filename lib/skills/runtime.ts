import type { AgentMission } from "@/lib/generated/prisma/client";
import { AppError } from "@/lib/api";
import { record } from "@/lib/conversation/repository";
import { json, type ToolResult, type Source } from "@/lib/mission/contracts";
import { db } from "@/lib/db";
import { event, validateSources, type Tx } from "@/lib/mission/repository";
import { fenced, type Lease } from "@/lib/mission/runtimeStore";
import { readProjectMaterial } from "@/lib/mission/sourceSignals";
import { loadBuiltinSkill } from "./loader";
import { BUILTIN_SKILLS, type BuiltinSkillId } from "./registry";
import { routeSkillRequest, type SkillRouteDecision } from "./router";
import { buildRoutingInput } from "./routingContext";
import { analyzeEvidence, mergeEvidencePack, type EvidencePack } from "./evidence";
import { investigationInputHash } from "@/lib/mission/investigationDelegation";

type Cursor = {
  schemaVersion: 2;
  contextVersion: number;
  planRevision: number;
  route: SkillRouteDecision;
  sequence: BuiltinSkillId[];
  stage: BuiltinSkillId;
  stageIndex: number;
  digests: Record<string, string>;
  evidencePack?: EvidencePack;
  outputId?: string;
  inputSnapshot?: { hash: string; contentHash: string };
};
function cursor(m: AgentMission): Cursor | undefined {
  const value = record(record(m.planJson).skillCursor) as unknown as Cursor;
  return value?.schemaVersion === 2 && value.route ? value : undefined;
}
function nextStage(c: Cursor): Cursor | null {
  const stageIndex = c.stageIndex + 1;
  if (stageIndex >= c.sequence.length) return null;
  return { ...c, stageIndex, stage: c.sequence[stageIndex] };
}

/** The method sequence is decided once per context/plan version from persisted state. */
export async function prepareSkillCursor(lease: Lease) {
  return db.$transaction(async tx => {
    const m = await fenced(tx, lease);
    if (m.runtimeProtocolVersion !== 2) return m;
    const old = cursor(m);
    if (old && old.contextVersion === m.contextVersion && old.planRevision === m.planRevision) {
      for (const [id, hash] of Object.entries(old.digests))
        if (loadBuiltinSkill(id as BuiltinSkillId).contentHash !== hash)
          throw new AppError("SKILL_VERSION_CHANGED", "内置方法已更新，原接力需人工核对后恢复", 409);
      return m;
    }
    const input = await buildRoutingInput(tx, m, { changedSinceLastRun: !!old && old.contextVersion !== m.contextVersion });
    const decision = routeSkillRequest(input);
    if (decision.mode !== "RUN")
      throw new AppError("SKILL_ROUTE_NOT_RUN", "当前输入属于" + decision.mode + "请求，不能作为内容执行继续", 409, { reasonCode: decision.reasonCode });
    if (!decision.sequence.length)
      throw new AppError("SKILL_ROUTE_EMPTY", "当前请求没有可执行的方法，请补充明确目标", 409);
    const digests = Object.fromEntries(decision.sequence.map(id => [id, loadBuiltinSkill(id).contentHash]));
    // A method that is still in the new plan must keep its exact version; removing a
    // method because the request changed is not a version change.
    if (old && Object.entries(old.digests).some(([id, hash]) => digests[id] && digests[id] !== hash))
      throw new AppError("SKILL_VERSION_CHANGED", "内置方法已更新，原接力需人工核对后恢复", 409);
    const seeded = decision.sequence[0] === "deliverable-creation" ? await seedEvidencePack(tx, m, input.activity.evidence)
      : old?.evidencePack && Object.values(old.digests).length ? old.evidencePack : undefined;
    const retained = seeded ?? undefined;
    const observed = await investigationInputHash(m, tx);
    const next: Cursor = {
      schemaVersion: 2, contextVersion: m.contextVersion, planRevision: m.planRevision, route: decision,
      sequence: decision.sequence, stage: decision.sequence[0], stageIndex: 0, digests, ...(retained ? { evidencePack: retained } : {}),
      inputSnapshot: { hash: observed.hash, contentHash: observed.contentHash },
    };
    await event(tx, m.id, "SKILL_ROUTE_DECIDED", {
      mode: decision.mode, primary: decision.primary, sequence: decision.sequence, reasonCode: decision.reasonCode,
      evidenceGate: decision.evidenceGate, restrictions: decision.restrictions, handoffOn: decision.handoffOn,
      intentHash: decision.intentHash, contextHash: decision.contextHash, toolAuthority: decision.toolAuthority,
    });
    await event(tx, m.id, "SKILL_ENTERED", { skillId: next.stage, contentHash: digests[next.stage], contextVersion: m.contextVersion,
      stageIndex: 0, sequence: next.sequence });
    return tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(m.planJson), skillCursor: next }) } });
  });
}

/**
 * A draft may start from evidence that already exists (a previous version's sources or
 * readable project material). Without usable sources the router plans research first.
 */
async function seedEvidencePack(tx: Tx, m: AgentMission, evidenceState: string): Promise<EvidencePack | undefined> {
  // Prefer what this Mission actually read: a previous version's refs or a succeeded read step.
  const latest = await tx.agentMissionOutput.findFirst({ where: { missionId: m.id }, orderBy: { revision: "desc" } });
  const outputRefs = ((latest?.sourceRefsJson as unknown as Source[] | null) ?? []).filter(source => source?.id && source?.hash);
  if (outputRefs.length) {
    try { await validateSources(m.projectId, outputRefs, tx, m.id); return analyzeEvidence(outputRefs, m.contextVersion); } catch { /* historical sources need a new read */ }
  }
  const readStep = await tx.agentMissionStep.findFirst({
    where: { missionId: m.id, status: "SUCCEEDED", toolName: { in: ["read_project_material", "inspect_project", "search_memory"] } },
    orderBy: [{ ordinal: "desc" }],
  });
  const stepRefs = ((readStep?.readSetJson as unknown as Source[] | null) ?? []).filter(source => source?.id && source?.hash);
  if (stepRefs.length) {
    try { await validateSources(m.projectId, stepRefs, tx, m.id); return analyzeEvidence(stepRefs, m.contextVersion); } catch { /* stale */ }
  }
  if (evidenceState === "NONE") return undefined;
  const [captures, attachments] = await Promise.all([
    tx.capture.findMany({ where: { projectId: m.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 6, select: { id: true } }),
    tx.attachment.findMany({ where: { projectId: m.projectId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 4, select: { id: true } }),
  ]);
  const sources: Source[] = [];
  for (const id of [...captures.map(row => "capture:" + row.id), ...attachments.map(row => "attachment:" + row.id)]) {
    const source = await readProjectMaterial(m.projectId, id, tx);
    if (source?.text.trim()) sources.push({ ...source, text: source.text.slice(0, 4000) });
    if (sources.length >= 8) break;
  }
  if (!sources.length) return undefined;
  await validateSources(m.projectId, sources, tx, m.id);
  return analyzeEvidence(sources, m.contextVersion);
}

/** Persist a request-level route before execution (used by conversation admission and the routing evaluator). */
export async function installRequestRoute(missionId: string, decision: SkillRouteDecision, source: "REQUEST_ADMISSION" | "EVALUATION_HARNESS" = "REQUEST_ADMISSION") {
  return db.$transaction(async tx => {
    const m = await tx.agentMission.findUniqueOrThrow({ where: { id: missionId } });
    if (m.runtimeProtocolVersion !== 2) throw new AppError("SKILL_ROUTE_PROTOCOL", "当前委托不是 v2 持续成果协议", 409);
    if (decision.mode !== "RUN" || !decision.sequence.length) throw new AppError("SKILL_ROUTE_NOT_RUN", "只有内容执行请求才能写入方法接力", 409);
    const digests = Object.fromEntries(decision.sequence.map(id => [id, loadBuiltinSkill(id).contentHash]));
    const seeded = decision.sequence[0] === "deliverable-creation" ? await seedEvidencePack(tx, m, "PARTIAL") : undefined;
    const next: Cursor = {
      schemaVersion: 2, contextVersion: m.contextVersion, planRevision: m.planRevision, route: decision,
      sequence: decision.sequence, stage: decision.sequence[0], stageIndex: 0, digests, ...(seeded ? { evidencePack: seeded } : {}),
    };
    await event(tx, m.id, "SKILL_ROUTE_DECIDED", {
      mode: decision.mode, primary: decision.primary, sequence: decision.sequence, reasonCode: decision.reasonCode,
      evidenceGate: decision.evidenceGate, restrictions: decision.restrictions, handoffOn: decision.handoffOn,
      intentHash: decision.intentHash, contextHash: decision.contextHash, toolAuthority: decision.toolAuthority, source,
    });
    await event(tx, m.id, "SKILL_ENTERED", { skillId: next.stage, contentHash: digests[next.stage], contextVersion: m.contextVersion, stageIndex: 0, sequence: next.sequence, source });
    return tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(m.planJson), skillCursor: next }) } });
  });
}

export function skillContext(m: AgentMission) {
  if (m.runtimeProtocolVersion !== 2) return undefined;
  const c = cursor(m);
  if (!c) return undefined;
  const skill = loadBuiltinSkill(c.stage);
  if (c.digests[c.stage] !== skill.contentHash) throw new AppError("SKILL_VERSION_CHANGED", "原接力的方法版本已变化", 409);
  const pending = c.sequence.map((id, index) => ({ id, label: BUILTIN_SKILLS[id].label, position: index + 1 }));
  return {
    ...skill, stage: c.stage, sequence: c.sequence, stageIndex: c.stageIndex, evidencePack: c.evidencePack, outputId: c.outputId,
    route: { mode: c.route.mode, reasonCode: c.route.reasonCode, primary: c.route.primary, sequence: c.route.sequence,
      evidenceGate: c.route.evidenceGate, handoffOn: c.route.handoffOn, restrictions: c.route.restrictions },
    remaining: c.sequence.slice(c.stageIndex).map((id, index) => ({ id, position: c.stageIndex + index + 1, label: BUILTIN_SKILLS[id].label })),
    pending,
    policy: "方法不是权限。工具、来源、送云、预算和副作用仍由原Mission服务校验；路由只能收窄原许可。",
  };
}

const EXTERNAL_READ_TOOLS = new Set([
  "web_search", "web_fetch", "browser_read", "read_paper_metadata", "read_repository_ci", "read_ci_jobs", "read_ci_log",
  "inspect_deployment", "read_deployment_logs", "search_memory_external",
]);

export async function assertSkillTool(tx: Tx, m: AgentMission, tool: string) {
  if (m.runtimeProtocolVersion !== 2) return;
  const c = cursor(m);
  if (!c || c.contextVersion !== m.contextVersion || c.planRevision !== m.planRevision)
    throw new AppError("SKILL_CURSOR_CHANGED", "接力上下文已变化，请读取当前原委托", 409);
  if (c.route.restrictions.noExternalRead && EXTERNAL_READ_TOOLS.has(tool))
    throw new AppError("SKILL_TOOL_RESTRICTED", "当前工作限制不允许联网或外部读取", 409);
  if (tool === "save_mission_output" || tool.startsWith("propose_")) {
    const terminal = c.stageIndex === c.sequence.length - 1;
    // A terminal non-creation Skill delivers its own stage artifact; this never becomes a report
    // revision and never creates a business action.
    if (tool === "save_mission_output" && c.stage !== "deliverable-creation" && terminal) {
      if (!c.evidencePack?.sources.length)
        throw new AppError("SKILL_GATE_NOT_MET", "先读取有效项目资料，再交付" + BUILTIN_SKILLS[c.stage].label + "阶段成果", 409);
      await validateSources(m.projectId, c.evidencePack.sources, tx, m.id);
      return;
    }
    if (c.route.restrictions.noOutputRevision)
      throw new AppError("SKILL_OUTPUT_RESTRICTED", "这轮只做" + BUILTIN_SKILLS[c.sequence[0]]?.label + "，不改动成果草稿", 409);
    if (c.stage !== "deliverable-creation")
      throw new AppError("SKILL_GATE_NOT_MET", "本轮计划未进入创作阶段，先完成" + BUILTIN_SKILLS[c.stage].label + "并形成证据包", 409);
    if (!c.evidencePack?.sources.length)
      throw new AppError("SKILL_GATE_NOT_MET", "先读取有效项目资料，形成证据包后再创作或提出操作", 409);
    await validateSources(m.projectId, c.evidencePack.sources, tx, m.id);
  }
}

export async function recordSkillResult(tx: Tx, m: AgentMission, tool: string, result: ToolResult) {
  if (m.runtimeProtocolVersion !== 2) return;
  const current = await tx.agentMission.findUniqueOrThrow({ where: { id: m.id } }), c = cursor(current);
  if (!c) return;
  if (tool === "save_mission_output") {
    const outputId = record(result.data).outputId;
    if (typeof outputId !== "string") throw new AppError("SKILL_OUTPUT_REQUIRED", "创作缺少真实成果编号", 409);
    const advanced = nextStage({ ...c, outputId });
    await event(tx, m.id, "SKILL_OUTPUT_READY", { skillId: c.stage, outputId });
    if (advanced)
      await event(tx, m.id, "SKILL_HANDOFF", { from: c.stage, to: advanced.stage, gate: "OUTPUT_CHECK", outputId,
        fromDigest: c.digests[c.stage], toDigest: c.digests[advanced.stage] });
    await tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(current.planJson), skillCursor: advanced ?? { ...c, outputId } }) } });
    return;
  }
  if (result.sources.length && c.stage !== "deliverable-creation") {
    await validateSources(m.projectId, result.sources, tx, m.id);
    const evidencePack = mergeEvidencePack(c.evidencePack, result.sources, m.contextVersion);
    await event(tx, m.id, "SKILL_EVIDENCE_PACK", { skillId: c.stage, sourceRefs: evidencePack.sources.map(source => ({ id: source.id, hash: source.hash })),
      coverage: evidencePack.coverage, unknowns: evidencePack.unknowns.map(unknown => ({ kind: unknown.kind, sourceId: unknown.sourceId, column: unknown.column })) });
    const advanced = nextStage({ ...c, evidencePack });
    if (advanced)
      await event(tx, m.id, "SKILL_HANDOFF", { from: c.stage, to: advanced.stage, gate: "EVIDENCE_PACK", sourceRefs: evidencePack.sources.map(source => ({ id: source.id, hash: source.hash })),
        fromDigest: c.digests[c.stage], toDigest: c.digests[advanced.stage] });
    await tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(current.planJson), skillCursor: advanced ?? { ...c, evidencePack } }) } });
    return;
  }
  await tx.agentMission.update({ where: { id: m.id }, data: { planJson: json({ ...record(current.planJson), skillCursor: c }) } });
}
